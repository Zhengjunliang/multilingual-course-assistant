// @vitest-environment jsdom

/**
 * The staff pages inside the chat shell, asked of the whole application.
 *
 * As in ChatPage.routing.test.tsx, the app's routes are mounted in a memory
 * router with the network faked at `fetch`. The assertions are what a reader of each
 * kind sees: the sidebar's groups and their order, where `/staff` lands, the
 * pages' headings and copy, and the breadcrumb; and what the shell keeps
 * across pages — the conversations it does not fetch again, the drawer a
 * Gestione link closes, the answer that leaving the chat stops.
 */

import { act, type ReactNode, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "@/App";
import type { Account } from "@/api/account";
import type { Course, Edition, Programme, StudyPlanCourse } from "@/api/catalog";
import type { ConversationSummary } from "@/api/conversations";
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { summary, uuidOf } from "@/test/conversations";
import { type Mounted, mount } from "@/test/mount";
import { codedRefusal, REQUEST_ID } from "@/test/refusal";
import { ThemeProvider } from "@/theme/ThemeProvider";

const B047: Programme = {
  code: "B047",
  name: "INGEGNERIA INFORMATICA",
  locale: "it",
  curricula: ["TECNICO APPLICATIVO", "TECNICO SCIENTIFICO"],
  course_count: 1,
  secretariat: [{ id: 2, username: "demo-secretariat", name: "Giulia Neri" }],
  permissions: ["programme.view"],
};
const B222: Programme = {
  ...B047,
  code: "B222",
  name: "INGEGNERIA GESTIONALE",
  curricula: [],
  secretariat: [],
};
const PLAN: StudyPlanCourse[] = [
  {
    course: {
      code: "B028451",
      name: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE",
      locale: "it",
      code_source: "moodle",
      entries: [
        {
          programme: { code: "B047", name: B047.name, locale: "it" },
          curriculum: "TECNICO APPLICATIVO",
          year_of_study: 3,
          ad_code: "B028451",
        },
      ],
    },
    current_edition: { id: 5, academic_year: "2025-2026", teachers: [] },
  },
];

const NAME_B047 = { code: "B047", name: B047.name, locale: "it" };
const NAME_B222 = { code: "B222", name: B222.name, locale: "it" };
/** PPM: two codes in B047's two curricula. */
const PPM: Course = {
  ...(PLAN[0]?.course as Course),
  entries: [
    {
      programme: NAME_B047,
      curriculum: "TECNICO APPLICATIVO",
      year_of_study: 3,
      ad_code: "B028451",
    },
    {
      programme: NAME_B047,
      curriculum: "TECNICO SCIENTIFICO",
      year_of_study: 3,
      ad_code: "B003712",
    },
  ],
};
/** A course both programmes list. */
const SHARED: Course = {
  code: "B000001",
  name: "ANALISI MATEMATICA I",
  locale: "it",
  code_source: "moodle",
  entries: [
    {
      programme: NAME_B047,
      curriculum: "TECNICO APPLICATIVO",
      year_of_study: 1,
      ad_code: "B000001",
    },
    { programme: NAME_B222, curriculum: "", year_of_study: 1, ad_code: "B000001" },
  ],
};

function edition(id: number, year: string, current: boolean, teachers: string[]): Edition {
  return {
    id,
    course: PPM,
    academic_year: year,
    teaching_starts: null,
    period: "",
    is_current: current,
    teachers: teachers.map((username, index) => ({ id: index + 10, username, name: "" })),
    permissions: ["edition.view"],
  };
}

/** PPM's editions, the newer first as the server lists them; the teacher teaches both. */
const EDITIONS: Edition[] = [
  {
    ...edition(5, "2025-2026", false, ["demo-colleague", "demo-teacher"]),
    teaching_starts: "2026-02-23",
    period: "second_semester",
  },
  edition(4, "2024-2025", true, ["demo-teacher"]),
];

function account(username: string, superuser: boolean, roles: Account["roles"]): Account {
  return { id: 1, username, locale: "it", is_superuser: superuser, roles };
}

const STUDENT = account("demo-student", false, []);
const TEACHER = account("demo-teacher", false, [{ role: "teacher", edition: 5 }]);
const SECRETARIAT = account("demo-secretariat", false, [
  { role: "secretariat", programme: "B047" },
]);
const BOTH = account("demo-both", false, [
  { role: "secretariat", programme: "B047" },
  { role: "secretariat", programme: "B222" },
]);
const ADMIN = account("demo-admin", true, []);
/** Secretariat staff who also teach. */
const DUAL = account("demo-dual", false, [
  { role: "secretariat", programme: "B047" },
  { role: "teacher", edition: 5 },
]);

/** What `GET /api/catalog/programmes` answers each account. */
const SCOPE: Record<string, Programme[]> = {
  "demo-teacher": [],
  "demo-secretariat": [B047],
  "demo-both": [B047, B222],
  "demo-dual": [B047],
  "demo-admin": [
    { ...B047, permissions: ["programme.assign_secretariat", "programme.view"] },
    { ...B222, permissions: ["programme.assign_secretariat", "programme.view"] },
  ],
};

/** Who is signed in when the page opens; null for a visitor. */
let reader: Account | null = STUDENT;
/** Who a visitor becomes on signing in. */
let signsInAs: Account = SECRETARIAT;
let conversations: ConversationSummary[] = [];
const asked: string[] = [];
/** Whether the answer stream was told to stop. */
let stopped = false;
/** Whether it had been, when a conversation's delete reached the server; `null` before any. */
let stoppedAtDelete: boolean | null = null;
/** Whether the server refuses a conversation's delete, as a server error would. */
let deleteRefused = false;
/** The next list of conversations, read as `body` and answered once `gate` opens. */
let lateList: { body: ConversationSummary[]; gate: Promise<void> } | null = null;
/** Secretariat staff revoked during a case, as the server would forget them. */
const revoked = new Set<string>();
/** Reads of the programme list that fail before one succeeds, as a server error would. */
let failures = 0;
/** Holds every read of one edition until it settles, as a slow server would. */
let held: Promise<void> | null = null;
/** Whether edition 5 has left the reader's scope since the page read it: every request about it is a 404. */
let lost = false;
/** PPM's editions older than EDITIONS, which a case adds to the list. */
let earlier: Edition[] = [];

/** An edition as the server would answer it now. */
function served(e: Edition): Edition {
  return {
    ...e,
    teachers: e.teachers.filter((t) => !revoked.has(t.username)),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** An answer that starts and never ends, until the request is aborted. */
function endlessAnswer(signal: AbortSignal | null | undefined): Response {
  const start = {
    question: "q",
    conversation_id: uuidOf(9),
    locale: "it",
    route: { target: "unifi_web", query: "q", fresh: false, reason: "campus question" },
    citations: [],
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`event: start\ndata: ${JSON.stringify(start)}\n\n`),
      );
      signal?.addEventListener("abort", () => {
        stopped = true;
        controller.error(new DOMException("aborted", "AbortError"));
      });
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  asked.push(`${method} ${path}`);
  const scope = SCOPE[reader?.username ?? ""] ?? [];
  const programme = scope.find((p) => path.startsWith(`/api/catalog/programmes/${p.code}`));
  if (method === "GET" && path === "/api/conversations") {
    if (lateList === null) return json(conversations);
    const { body, gate } = lateList;
    lateList = null;
    await gate;
    return json(body);
  }
  if (method === "POST" && path === "/api/ask") {
    conversations = [
      summary({ id: uuidOf(9), created_at: "2026-10-05T09:00:00Z", title: "q" }),
      ...conversations,
    ];
    return endlessAnswer(init.signal);
  }
  if (method === "DELETE" && path.startsWith("/api/conversations/")) {
    stoppedAtDelete = stopped;
    if (deleteRefused) return codedRefusal("INTERNAL");
    const id = path.slice("/api/conversations/".length);
    conversations = conversations.filter((listed) => listed.id !== id);
    return new Response(null, { status: 204 });
  }
  if (path === "/api/catalog/programmes") {
    if (failures > 0) {
      failures -= 1;
      return codedRefusal("INTERNAL");
    }
    return json(scope);
  }
  // A teacher views no programme, so no course.
  const course = [PPM, SHARED].find((c) => path === `/api/catalog/courses/${c.code}`);
  if (course !== undefined && scope.length > 0) return json(course);
  if (path === "/api/catalog/editions") return json([...EDITIONS, ...earlier].map(served));
  if (path.startsWith("/api/catalog/editions?course=")) {
    return json(EDITIONS.filter((e) => path.endsWith(`=${e.course.code}`)).map(served));
  }
  if (method === "DELETE" && path.startsWith("/api/catalog/editions/")) {
    revoked.add(path.slice(path.lastIndexOf("/") + 1));
    return new Response(null, { status: 204 });
  }
  if (lost && path.startsWith("/api/catalog/editions/5")) {
    return codedRefusal("NOT_FOUND");
  }
  // Every edition's syllabus and books are empty: the pages around them are what this file asks.
  if (/^\/api\/catalog\/editions\/\d+\/syllabus$/.test(path)) {
    return json({ locale: "it", sections: [] });
  }
  if (/^\/api\/catalog\/editions\/\d+\/readings$/.test(path)) return json([]);
  const one = EDITIONS.find((e) => path === `/api/catalog/editions/${e.id}`);
  if (one !== undefined) {
    await held;
    // Secretariat staff may assign a teacher; the teacher may not.
    const assigns = scope.length > 0 ? ["edition.assign_teacher"] : [];
    return json({ ...served(one), permissions: [...assigns, ...one.permissions] });
  }
  if (programme !== undefined && path.endsWith("/courses")) return json(PLAN);
  if (method === "DELETE" && programme !== undefined) {
    revoked.add(path.slice(path.lastIndexOf("/") + 1));
    return new Response(null, { status: 204 });
  }
  if (programme !== undefined) {
    const secretariat = programme.secretariat.filter((m) => !revoked.has(m.username));
    return json({ ...programme, secretariat });
  }
  return codedRefusal("NOT_FOUND");
}

/** The session, which a visitor's sign-in fills with `signsInAs`. */
function Session({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(reader);
  return (
    <SessionContext
      value={{
        account,
        logIn: async () => setAccount(signsInAs),
        register: async () => {},
        logOut: async () => {},
        chooseLocale: async () => {},
        forget: () => {},
        recheck: async () => {},
      }}
    >
      {children}
    </SessionContext>
  );
}

interface Page extends Mounted {
  /** Where the router is, as the address bar shows it: the path and its query. */
  path: () => string;
  /** Moves the router as the history would, without a link on the page. */
  go: (to: string) => Promise<void>;
  /** The browser's Back. */
  back: () => Promise<void>;
}

function page(path: string): Page {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const mounted = mount(
    <ThemeProvider>
      <Session>
        <RouterProvider router={router} />
      </Session>
    </ThemeProvider>,
  );
  return {
    ...mounted,
    path: () => `${router.state.location.pathname}${router.state.location.search}`,
    go: (to) => router.navigate(to),
    back: () => router.navigate(-1),
  };
}

/** Shows the tab whose label starts with `label`, as a press of the pointer does: Radix's trigger answers the mousedown. */
function showTab(container: HTMLElement, label: string) {
  const tab = [...container.querySelectorAll('main [role="tab"]')].find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  act(() => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
}

/** A key pressed with the focus on the page, outside any field. */
function press(key: string) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** What a screen reader reads of `element`: its text without the parts hidden from it. */
function text(element: Element | null | undefined): string | null {
  if (!element) return null;
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll("[aria-hidden]")) hidden.remove();
  return copy.textContent?.trim() ?? null;
}

function click(element: HTMLElement | null | undefined) {
  act(() => element?.click());
}

/** The links of the sidebar's Gestione group, as label, count → address. */
function gestione(root: ParentNode) {
  const nav = root.querySelector('nav[aria-label="Gestione"]');
  return [...(nav?.querySelectorAll("a") ?? [])].map((a) => {
    const [label, count] = [...a.querySelectorAll("span")].map((span) => span.textContent);
    return [label, count, a.getAttribute("href")];
  });
}

function crumbs(container: HTMLElement) {
  return [...container.querySelectorAll('header nav[aria-label="Percorso"] li')].map((li) => {
    const link = li.querySelector("a");
    const current = li.querySelector('[aria-current="page"]') !== null;
    return `${text(li)}${link ? " →" : ""}${current ? " (current)" : ""}`;
  });
}

beforeEach(() => {
  conversations = [summary({ id: uuidOf(7), created_at: "2026-10-04T10:00:00Z", title: "ORM" })];
  asked.length = 0;
  stopped = false;
  stoppedAtDelete = null;
  deleteRefused = false;
  lateList = null;
  revoked.clear();
  failures = 0;
  held = null;
  lost = false;
  earlier = [];
  // Each test is a tab of its own: no row noted by another (features/staff/openedRow.ts).
  sessionStorage.clear();
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Gestione group and /staff", () => {
  it.each<[string, Account, string[][], string]>([
    ["a student", STUDENT, [], "/"],
    // Each item counts what its page lists: the editions taught, the one
    // programme's courses, the programmes.
    ["a teacher", TEACHER, [["I miei insegnamenti", "1", "/staff/mine"]], "/staff/mine"],
    [
      "one programme's secretariat",
      SECRETARIAT,
      [["Corso di laurea", "1", "/staff/programmes/B047"]],
      "/staff/programmes/B047",
    ],
    [
      "two programmes' secretariat",
      BOTH,
      [["Corsi di laurea", "2", "/staff/programmes"]],
      "/staff/programmes",
    ],
    ["the superuser", ADMIN, [["Corsi di laurea", "2", "/staff/programmes"]], "/staff/programmes"],
    // The programme first, and `/staff` waits for the list to know it.
    [
      "secretariat staff who teach",
      DUAL,
      [
        ["Corso di laurea", "1", "/staff/programmes/B047"],
        ["I miei insegnamenti", "1", "/staff/mine"],
      ],
      "/staff/programmes/B047",
    ],
  ])("for %s", async (_, who, items, lands) => {
    reader = who;
    const { container, unmount, path } = page("/staff");
    await settle();
    const seen = {
      items: gestione(container),
      lands: path(),
      programmesAsked: asked.includes("GET /api/catalog/programmes"),
    };
    unmount();

    expect(seen).toEqual({
      items,
      lands,
      programmesAsked: who !== STUDENT,
    });
  });

  it("sits between the new conversation and the conversations", async () => {
    reader = ADMIN;
    const { container, unmount } = page("/");
    await settle();
    const aside = container.querySelector("aside");
    const order = [
      aside?.querySelector('a[href="/"]'),
      aside?.querySelector('nav[aria-label="Gestione"]'),
      aside?.querySelector('nav[aria-label="Recenti"]'),
    ];
    const following = order
      .slice(1)
      .map((node, i) => Boolean(node && order[i]?.compareDocumentPosition(node) === 4));
    unmount();

    expect(following).toEqual([true, true]);
  });
});

describe("signing in", () => {
  // Under reduced motion the page leaves as soon as the sign-in is accepted,
  // with no check to watch first (routes/landing.ts): where it lands is this
  // test's question, not how long it takes to go.
  beforeEach(() => {
    const media = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => ({
      ...media(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
  });

  it.each([
    // The staff page asked for, its programme included.
    ["a staff page", "/staff/editions/5?programme=B047", "/staff/editions/5?programme=B047"],
    // Signing in from the login page lands on the chat, never on Gestione.
    ["the login page", "/login", "/"],
  ])("from %s", async (_, start, lands) => {
    reader = null;
    signsInAs = SECRETARIAT;
    const { container, unmount, path } = page(start);
    await settle();
    const asked = path();
    act(() => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    });
    await settle();
    const landed = path();
    unmount();

    expect([asked, landed]).toEqual(["/login", lands]);
  });
});

describe("the programme pages", () => {
  it("lists the programmes, each row one link, and an empty secretariat as nobody", async () => {
    reader = ADMIN;
    const { container, unmount } = page("/staff/programmes");
    await settle();
    const seen = {
      title: text(container.querySelector("main h1")),
      columns: [...container.querySelectorAll("main th")].map(text),
      links: [...container.querySelectorAll("main tbody a")].map((a) => a.getAttribute("href")),
      rows: [...container.querySelectorAll<HTMLTableRowElement>("main tbody tr")].map((tr) => [
        text(tr.cells[0]),
        text(tr.cells[3]),
      ]),
      chips: [...container.querySelectorAll("main header .flex-wrap > span")].map(text),
      crumbs: crumbs(container),
    };
    unmount();

    expect(seen).toEqual({
      title: "Corsi di laurea",
      columns: ["Corso di laurea", "Curriculum", "Insegnamenti", "Segreteria didattica", "Apri"],
      chips: ["2 corsi di laurea"],
      links: ["/staff/programmes/B047", "/staff/programmes/B222"],
      // The name over the code, and the secretariat by name.
      rows: [
        ["INGEGNERIA INFORMATICAB047", "Giulia Neri"],
        ["INGEGNERIA GESTIONALEB222", "Nessuno"],
      ],
      crumbs: ["Corsi di laurea (current)"],
    });
  });

  it.each([
    [
      "its secretariat, who cannot assign",
      SECRETARIAT,
      ["Corso di laurea", "B047 · INGEGNERIA INFORMATICA (current)"],
      true,
    ],
    [
      "the superuser, who can",
      ADMIN,
      ["Corsi di laurea →", "B047 · INGEGNERIA INFORMATICA (current)"],
      false,
    ],
  ])("shows a programme to %s", async (_, who, path, footnote) => {
    reader = who;
    const { container, unmount } = page("/staff/programmes/B047");
    await settle();
    const banner = [...container.querySelectorAll("main p")].some(
      (p) => p.textContent === "Solo l'amministratore assegna la segreteria didattica.",
    );
    const seen = {
      title: text(container.querySelector("main h1")),
      chips: [...container.querySelectorAll("main header .flex-wrap > span")].map(text),
      crumbs: crumbs(container),
      tabs: [...container.querySelectorAll('main [role="tab"]')].map(text),
      years: [...container.querySelectorAll('main [aria-label="Anno di corso"] button')].map(text),
      group: text(container.querySelector('main th[scope="colgroup"]')),
      people: [...container.querySelectorAll("main ul li")].map(text),
      banner,
    };
    unmount();

    expect(seen).toEqual({
      title: "INGEGNERIA INFORMATICA",
      chips: ["B047", "TECNICO APPLICATIVO", "TECNICO SCIENTIFICO", "1 insegnamento"],
      crumbs: path,
      // Each tab and each year with the rows it shows.
      tabs: [`${i18n.t("staff.plan.title")}1`, "Segreteria didattica1"],
      years: ["Tutti1", "3° anno1"],
      group: "3° anno · 1 insegnamento",
      // Behind its tab, kept mounted: name over username, and the role.
      people: [
        who === ADMIN
          ? "Giulia Neridemo-secretariatSegreteriaRevoca"
          : "Giulia Neritudemo-secretariatSegreteria",
      ],
      banner: footnote,
    });
  });

  it("starts the plan on every year and curriculum chosen, and keeps a year pressed again", async () => {
    reader = ADMIN;
    const { container, unmount } = page("/staff/programmes/B047");
    await settle();
    const chosen = () =>
      [...container.querySelectorAll('main [role="radio"][aria-checked="true"]')].map(text);
    const atStart = chosen();
    const third = [...container.querySelectorAll<HTMLButtonElement>('main [role="radio"]')].find(
      (option) => option.textContent?.startsWith("3°"),
    );
    act(() => third?.click());
    act(() => third?.click());
    const again = chosen();
    unmount();

    expect({ atStart, again }).toEqual({
      atStart: ["Tutti1", "Tutti"],
      again: ["3° anno1", "Tutti"],
    });
  });

  it("puts the focus in the plan's filter on /, typing nothing, and keeps the filter across the tabs", async () => {
    reader = ADMIN;
    const { container, unmount } = page("/staff/programmes/B047");
    await settle();
    const field = container.querySelector<HTMLInputElement>('main input[type="search"]');
    press("/");
    const reached = [document.activeElement === field, field?.value];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(field, "fisica");
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    showTab(container, "Segreteria didattica");
    act(() => field?.blur());
    // Behind another tab, the plan's filter is not where "/" goes.
    press("/");
    const away = document.activeElement === field;
    showTab(container, i18n.t("staff.plan.title"));
    const kept = [
      field?.value,
      (container.textContent ?? "").includes("Nessun insegnamento corrisponde"),
    ];
    unmount();

    expect({ reached, away, kept }).toEqual({
      reached: [true, ""],
      away: false,
      kept: ["fisica", true],
    });
  });

  it.each([
    ["a programme outside the caller's scope", "/staff/programmes/B222"],
    ["a path that names no page", "/staff/nowhere"],
  ])("says %s is not found, with the way back to the reader's start", async (_, path) => {
    reader = SECRETARIAT;
    const { container, unmount } = page(path);
    await settle();
    const back = container.querySelector("main a");
    const seen = {
      title: text(container.querySelector("main h1")),
      back: [text(back), back?.getAttribute("href")],
      crumbs: crumbs(container),
    };
    unmount();

    expect(seen).toEqual({
      title: "Non trovato",
      back: ["Torna all'inizio", "/staff/programmes/B047"],
      crumbs: ["Non trovato (current)"],
    });
  });
});

describe("a course, an edition, and a teacher's own courses", () => {
  it("shows a course's study plans and editions, reached through a programme", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/staff/courses/B028451?programme=B047");
    await settle();
    const seen = {
      title: text(container.querySelector("main h1")),
      cards: [...container.querySelectorAll("main h3")].map(text),
      note: (container.textContent ?? "").includes(
        "Due codici, un solo insegnamento: ogni edizione vale per entrambi i curriculum.",
      ),
      tabs: [...container.querySelectorAll('main [role="tab"]')].map(text),
      editions: [...container.querySelectorAll<HTMLTableRowElement>("main tbody tr")].map((tr) => [
        tr.querySelector("a")?.getAttribute("href"),
        text(tr.cells[1]),
        text(tr.cells[2]),
        text(tr.cells[3]),
      ]),
      crumbs: crumbs(container),
      // The Gestione item the course is under, not the page itself.
      current: [...container.querySelectorAll('nav[aria-label="Gestione"] a')].map((a) =>
        a.getAttribute("aria-current"),
      ),
    };
    unmount();

    expect(seen).toEqual({
      title: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE",
      cards: ["INGEGNERIA INFORMATICA"],
      note: true,
      // Behind its tab, kept mounted.
      tabs: ["Edizioni2", `${i18n.t("staff.course.inPlan")}1`],
      editions: [
        [
          "/staff/editions/5?programme=B047",
          "2° semestre", // spellchecker:disable-line
          "Non corrente",
          "demo-colleague, demo-teacher",
        ],
        // An edition nobody gave a period shows a dash.
        ["/staff/editions/4?programme=B047", "—", "Corrente", "demo-teacher"],
      ],
      crumbs: [
        "Corso di laurea",
        "B047 · INGEGNERIA INFORMATICA →",
        "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE (current)",
      ],
      current: ["true"],
    });
  });

  it("says who else manages a course two programmes list", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/staff/courses/B000001");
    await settle();
    const seen = {
      cards: [...container.querySelectorAll("main h3")].map(text),
      shared: (container.textContent ?? "").includes(
        "Lo gestiscono le segreterie di entrambi i corsi di laurea.",
      ),
    };
    unmount();

    expect(seen).toEqual({
      cards: ["INGEGNERIA INFORMATICA", "INGEGNERIA GESTIONALE"],
      shared: true,
    });
  });

  it("lists a teacher's courses from the current edition on, every year on Tutte, and keeps the view on Back", async () => {
    reader = TEACHER;
    earlier = [edition(3, "2023-2024", false, [])];
    const { container, unmount, path, back } = page("/staff");
    await settle();
    const seen = () => ({
      path: path(),
      // The note on switching the current edition went with the switch.
      note: (container.querySelector("main")?.textContent ?? "").includes("al massimo"),
      chips: [...container.querySelectorAll("main header .flex-wrap > span")].map(text),
      views: [...container.querySelectorAll('main nav[aria-label="Edizioni mostrate"] a')].map(
        (a) => [text(a), a.getAttribute("href"), a.getAttribute("aria-current")],
      ),
      rows: [...container.querySelectorAll<HTMLTableRowElement>("main tbody tr")].map((tr) => [
        tr.querySelector("a")?.getAttribute("href"),
        text(tr.querySelector("a")),
        [...tr.cells].slice(1).map(text),
      ]),
    });
    const current = seen();
    click(container.querySelector<HTMLAnchorElement>('main nav a[href="/staff/mine?show=all"]'));
    await settle();
    const all = seen();
    click(container.querySelector<HTMLAnchorElement>('main a[href="/staff/editions/3"]'));
    await settle();
    await act(() => back());
    await settle();
    const returned = [path(), container.querySelectorAll("main tbody tr").length];
    unmount();

    const rows = [
      [
        "/staff/editions/5",
        "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026",
        ["2025-2026", "2° semestre", "Non corrente", "demo-colleague, demo-teacher", ""], // spellchecker:disable-line
      ],
      [
        "/staff/editions/4",
        "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2024-2025",
        ["2024-2025", "—", "Corrente", "demo-teacher", ""],
      ],
    ];
    expect({ current, all, returned }).toEqual({
      // The year before the current one is a year nobody teaches it: on Tutte only.
      current: {
        path: "/staff/mine",
        note: false,
        chips: ["1 insegnamento"],
        views: [
          ["Correnti2", "/staff/mine", "page"], // spellchecker:disable-line
          ["Tutte3", "/staff/mine?show=all", null],
        ],
        // The link names the year, since both rows are the same course.
        rows,
      },
      all: {
        path: "/staff/mine?show=all",
        note: false,
        chips: ["1 insegnamento"],
        views: [
          ["Correnti2", "/staff/mine", null], // spellchecker:disable-line
          ["Tutte3", "/staff/mine?show=all", "page"],
        ],
        rows: [
          ...rows,
          [
            "/staff/editions/3",
            "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2023-2024",
            ["2023-2024", "—", "Non corrente", "", ""],
          ],
        ],
      },
      returned: ["/staff/mine?show=all", 3],
    });
  });

  it("says so when the teacher teaches nothing", async () => {
    reader = account("demo-new", false, [{ role: "teacher", edition: 99 }]);
    const { container, unmount } = page("/staff/mine");
    await settle();
    const seen = [
      container.querySelectorAll("main h2").length,
      (container.textContent ?? "").includes("Nessun insegnamento assegnato."),
    ];
    unmount();

    expect(seen).toEqual([0, true]);
  });

  it.each([
    [
      "its teacher, who reads it under their own courses",
      TEACHER,
      "/staff/editions/5",
      ["I miei insegnamenti →", "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026 (current)"],
      false,
    ],
    [
      "secretariat staff, who may assign, through their programme",
      SECRETARIAT,
      "/staff/editions/5?programme=B047",
      [
        "Corso di laurea",
        "B047 · INGEGNERIA INFORMATICA →",
        "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE →",
        "2025-2026 (current)",
      ],
      true,
    ],
  ])("shows an edition's teachers to %s", async (_, who, path, trail, assigns) => {
    reader = who;
    const { container, unmount } = page(path);
    await settle();
    const seen = {
      chips: [...container.querySelectorAll("main header .flex-wrap > span")].map(text),
      people: [...container.querySelectorAll("main ul li")].map(text),
      crumbs: crumbs(container),
      refusal: (container.querySelector("main")?.textContent ?? "").includes("non assegnare"),
      assign: text(container.querySelector("main header [data-assign]")),
    };
    unmount();

    expect(seen).toEqual({
      // Its semester, and the day its teaching starts, which is what makes an edition current.
      chips: [
        "2025-2026",
        "Non corrente",
        "2° semestre", // spellchecker:disable-line
        "Lezioni dal 23 febbraio 2026",
        "B028451",
      ],
      // The reader is marked as themselves; whoever may assign gets a "Revoca" per row.
      people:
        who === TEACHER
          ? ["demo-colleagueDocente", "demo-teachertuDocente"]
          : ["demo-colleagueDocenteRevoca", "demo-teacherDocenteRevoca"],
      crumbs: trail,
      // The button for whoever may assign, and nothing in its place for anyone else.
      refusal: false,
      assign: assigns ? "Assegna docente" : null,
    });
  });

  it("marks and focuses the row a reader opened on coming back with Back, its path kept", async () => {
    reader = SECRETARIAT;
    const { container, unmount, back, path } = page("/staff/courses/B028451?programme=B047");
    await settle();
    const before = container.querySelectorAll("main tr[data-selected]").length;
    act(() =>
      container.querySelector<HTMLAnchorElement>('main a[href^="/staff/editions/5"]')?.click(),
    );
    await settle();
    await act(() => back());
    await settle();
    const row = container.querySelector("main tr[data-selected]");
    const seen = [
      before,
      path(),
      row?.querySelector("a")?.getAttribute("href"),
      document.activeElement === row?.querySelector("a"),
    ];
    unmount();

    expect(seen).toEqual([
      0,
      "/staff/courses/B028451?programme=B047",
      "/staff/editions/5?programme=B047",
      true,
    ]);
  });

  it("marks nothing on another page loaded afresh, though the last one loaded afresh noted a row", async () => {
    reader = TEACHER;
    const mine = page("/staff/mine");
    await settle();
    act(() =>
      mine.container.querySelector<HTMLAnchorElement>('main a[href="/staff/editions/5"]')?.click(),
    );
    await settle();
    mine.unmount();
    reader = SECRETARIAT;
    // Another page opened from the address bar: its first entry, like the last one's.
    const { container, unmount } = page("/staff/courses/B028451?programme=B047");
    await settle();
    const marked = container.querySelectorAll("main tr[data-selected]").length;
    unmount();

    expect(marked).toBe(0);
  });

  it("marks nothing on the same page loaded afresh again, a load of its own", async () => {
    reader = SECRETARIAT;
    const path = "/staff/courses/B028451?programme=B047";
    const load = vi.spyOn(performance, "timeOrigin", "get").mockReturnValue(1000);
    const first = page(path);
    await settle();
    act(() =>
      first.container
        .querySelector<HTMLAnchorElement>('main a[href^="/staff/editions/5"]')
        ?.click(),
    );
    await settle();
    first.unmount();
    // The same address from a bookmark: its first entry is "default" again, in another load.
    load.mockReturnValue(2000);
    const { container, unmount } = page(path);
    await settle();
    const marked = container.querySelectorAll("main tr[data-selected]").length;
    unmount();
    load.mockRestore();

    expect(marked).toBe(0);
  });

  it("leaves the focus where a dialog puts it once the page reads again after Back", async () => {
    reader = ADMIN;
    const { container, unmount, back } = page("/staff/programmes/B047");
    await settle();
    act(() =>
      container.querySelector<HTMLAnchorElement>('main a[href^="/staff/courses/"]')?.click(),
    );
    await settle();
    await act(() => back());
    await settle();
    const marked = document.activeElement?.closest("tr")?.hasAttribute("data-selected");
    showTab(container, "Segreteria didattica");
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Revoca Giulia Neri"]')
        ?.click(),
    );
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((candidate) => candidate.textContent === "Revoca");
    act(() => confirm?.click());
    await settle();
    const focused = document.activeElement?.textContent?.trim();
    unmount();

    expect([marked, focused]).toEqual([true, "Assegna segreteria"]);
  });

  it("shows nothing of one edition while the next is read", async () => {
    reader = SECRETARIAT;
    const { container, unmount, go } = page("/staff/editions/5?programme=B047");
    await settle();
    const before = crumbs(container).at(-1);
    let answer = () => {};
    held = new Promise((resolve) => {
      answer = resolve;
    });
    await act(() => go("/staff/editions/4?programme=B047"));
    const during = [text(container.querySelector("main h1")), crumbs(container).at(-1)];
    answer();
    await settle();
    const after = crumbs(container).at(-1);
    unmount();

    expect({ before, during, after }).toEqual({
      before: "2025-2026 (current)",
      during: [null, undefined],
      after: "2024-2025 (current)",
    });
  });

  it("sends a teacher who opens a course page back to their own courses", async () => {
    reader = TEACHER;
    const { container, unmount } = page("/staff/courses/B028451");
    await settle();
    const back = container.querySelector("main a");
    const seen = [text(container.querySelector("main h1")), text(back), back?.getAttribute("href")];
    unmount();

    expect(seen).toEqual(["Non trovato", "Torna ai miei insegnamenti", "/staff/mine"]);
  });
});

describe("a read that fails", () => {
  it("says why, with the reference, offers to read again, and shows the page once the read succeeds", async () => {
    reader = ADMIN;
    // The shell's own read of the list, then the page's.
    failures = 2;
    const { container, unmount } = page("/staff/programmes");
    await settle();
    const said = text(container.querySelector('main [role="alert"]'));
    // Under the words, outside what is read out; and no chip after the disc.
    const reference = text(container.querySelector("main [data-status-panel] > p"));
    const chip = container.querySelector("main [data-status-panel] > span + span");
    // A failed read is not a page that does not exist.
    const trail = crumbs(container);
    const retry = [...container.querySelectorAll<HTMLButtonElement>("main button")].find(
      (button) => button.textContent === "Riprova",
    );
    act(() => retry?.click());
    await settle();
    const title = text(container.querySelector("main h1"));
    unmount();

    expect([said, reference, chip, trail, title]).toEqual([
      `${i18n.t("staff.failure.title")}${i18n.t("errors.INTERNAL")}`,
      `INTERNAL · rif. ${REQUEST_ID}`,
      null,
      ["Corsi di laurea (current)"],
      "Corsi di laurea",
    ]);
  });
});

describe("a write from a page", () => {
  it("hands focus back to the button that opened a dialog", async () => {
    reader = ADMIN;
    const { container, unmount } = page("/staff/programmes/B047");
    await settle();
    showTab(container, "Segreteria didattica");
    const assign = container.querySelector<HTMLButtonElement>("main [data-assign]");
    act(() => {
      assign?.focus();
      assign?.click();
    });
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((candidate) => candidate.textContent === "Annulla");
    act(() => cancel?.click());
    await settle();
    const seen = [
      document.body.querySelector('[role="dialog"]'),
      document.activeElement === assign,
    ];
    unmount();

    expect(seen).toEqual([null, true]);
  });

  it("hands focus to the not-found panel's heading when the edition left the reader's scope meanwhile", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/staff/editions/5?programme=B047");
    await settle();
    lost = true;
    act(() => container.querySelector<HTMLButtonElement>("main [data-assign]")?.click());
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "mrossi");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input?.form?.requestSubmit());
    await settle();
    const seen = [document.body.querySelector('[role="dialog"]'), text(document.activeElement)];
    unmount();

    expect(seen).toEqual([null, "Non trovato"]);
  });

  it.each([
    [
      "the next row's Revoca",
      "/staff/editions/5?programme=B047",
      "demo-colleague",
      "Revoca demo-teacher",
      false,
    ],
    [
      "the assign button, with nobody left",
      "/staff/editions/4?programme=B047",
      "demo-teacher",
      "Assegna docente",
      true,
    ],
  ])("revokes a teacher and hands focus to %s", async (_, path, revoking, focus, empty) => {
    reader = SECRETARIAT;
    const { container, unmount } = page(path);
    await settle();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="Revoca ${revoking}"]`)
        ?.click(),
    );
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((candidate) => candidate.textContent === "Revoca");
    act(() => confirm?.click());
    await settle();
    const active = document.activeElement;
    const seen = {
      focused: active?.getAttribute("aria-label") ?? active?.textContent?.trim(),
      empty: (container.textContent ?? "").includes("Nessun docente assegnato a questa edizione."),
    };
    unmount();

    expect(seen).toEqual({ focused: focus, empty });
  });

  it("revokes the last secretariat member, says so, and hands focus to the assign button", async () => {
    reader = ADMIN;
    const { container, unmount } = page("/staff/programmes/B047");
    await settle();
    showTab(container, "Segreteria didattica");
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Revoca Giulia Neri"]')
        ?.click(),
    );
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((candidate) => candidate.textContent === "Revoca");
    act(() => confirm?.click());
    await settle();
    const seen = {
      left: (container.textContent ?? "").includes("Nessun membro della segreteria didattica."),
      toast: (document.body.textContent ?? "").includes("Ruolo revocato"),
      focused: document.activeElement?.textContent?.trim(),
      // The toast goes with the shell, so signing in again does not show it.
      again: false,
    };
    unmount();
    const next = page("/staff/programmes/B047");
    await settle();
    seen.again = (document.body.textContent ?? "").includes("Ruolo revocato");
    next.unmount();

    expect(seen).toEqual({
      left: true,
      toast: true,
      focused: "Assegna segreteria",
      again: false,
    });
  });
});

describe("the shell across pages", () => {
  it("does not fetch the conversations again between the chat and a staff page", async () => {
    reader = SECRETARIAT;
    const { container, unmount, path } = page("/");
    await settle();
    click(container.querySelector<HTMLAnchorElement>('aside nav[aria-label="Gestione"] a'));
    await settle();
    const onStaff = path();
    click(container.querySelector<HTMLAnchorElement>('aside a[href="/"]'));
    await settle();
    const back = path();
    unmount();

    expect([onStaff, back]).toEqual(["/staff/programmes/B047", "/"]);
    expect(asked.filter((call) => call === "GET /api/conversations")).toHaveLength(1);
  });

  it("closes the narrow-screen drawer when a Gestione link is followed", async () => {
    reader = SECRETARIAT;
    const { container, unmount, path } = page("/");
    await settle();
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Apri il menu"]'));
    const drawer = document.body.querySelector('[role="dialog"]');
    click(drawer?.querySelector<HTMLAnchorElement>('nav[aria-label="Gestione"] a'));
    await settle();
    const seen = [Boolean(drawer), document.body.querySelector('[role="dialog"]'), path()];
    unmount();

    expect(seen).toEqual([true, null, "/staff/programmes/B047"]);
  });

  it("stops an answer when the reader leaves for a staff page", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/");
    await settle();
    await askFromTheFrontDoor(container);
    const whileAnswering = stopped;
    click(container.querySelector<HTMLAnchorElement>('aside nav[aria-label="Gestione"] a'));
    await settle();
    unmount();

    expect([whileAnswering, stopped]).toEqual([false, true]);
  });
});

/** Types a question into the composer under the entry and presses send; the answer never ends. */
async function askFromTheFrontDoor(container: HTMLElement) {
  const field = container.querySelector<HTMLTextAreaElement>("#question");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, "Quali sono le scadenze per l'iscrizione?");
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  click(container.querySelector<HTMLButtonElement>("button[type='submit']"));
  await settle();
}

/**
 * Deletes the sidebar row titled `title` through its confirmation: whether its
 * button could be pressed, and what the confirmation said.
 */
function deleteRow(container: HTMLElement, title: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `aside button[aria-label="Elimina «${title}»"]`,
  );
  const pressable = button !== null && !button.disabled;
  click(button);
  const dialog = document.body.querySelector('[role="alertdialog"]');
  const said = document.getElementById(dialog?.getAttribute("aria-describedby") ?? "")?.textContent;
  click(
    [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (candidate) => candidate.textContent === i18n.t("sidebar.deleteConfirm"),
    ),
  );
  return { pressable, said };
}

describe("deleting while an answer is written", () => {
  it("deletes the conversation being answered, saying so, and then stops the answer", async () => {
    reader = STUDENT;
    const { container, unmount, path } = page("/");
    await settle();
    await askFromTheFrontDoor(container);
    const offered = deleteRow(container, "q");
    await settle();
    const seen = {
      ...offered,
      stoppedAtDelete,
      stopped,
      path: path(),
      row: container.querySelector(`aside a[href="/chat/${uuidOf(9)}"]`),
    };
    unmount();

    expect(seen).toEqual({
      pressable: true,
      said: i18n.t("sidebar.deleteBodyAnswering", { title: "q" }),
      stoppedAtDelete: false,
      stopped: true,
      path: "/",
      row: null,
    });
  });

  it("keeps the answer coming when the server refuses the delete", async () => {
    reader = STUDENT;
    deleteRefused = true;
    const { container, unmount, path } = page("/");
    await settle();
    await askFromTheFrontDoor(container);
    deleteRow(container, "q");
    await settle();
    const seen = {
      stopped,
      path: path(),
      row: container.querySelector(`aside a[href="/chat/${uuidOf(9)}"]`) !== null,
      said: document.body.textContent?.includes(i18n.t("sidebar.deleteFailed")),
    };
    unmount();

    expect(seen).toEqual({ stopped: false, path: `/chat/${uuidOf(9)}`, row: true, said: true });
  });

  it("keeps the deleted conversation off the list when an older list arrives last", async () => {
    reader = STUDENT;
    const { container, unmount } = page("/");
    await settle();
    await askFromTheFrontDoor(container);
    // The next list's reply carries the deleted conversation, as one the
    // server read before the delete landed would, and comes in after the
    // reply to the list asked for after it: whichever request it answers,
    // the list asked for last is the one kept.
    let answer = () => {};
    lateList = {
      body: [...conversations],
      gate: new Promise((resolve) => {
        answer = resolve;
      }),
    };
    deleteRow(container, "q");
    await settle();
    const late = lateList === null;
    answer();
    await settle();
    const row = container.querySelector(`aside a[href="/chat/${uuidOf(9)}"]`);
    unmount();

    expect({ late, row }).toEqual({ late: true, row: null });
  });

  it("leaves the answer be when another conversation is deleted", async () => {
    reader = STUDENT;
    const { container, unmount, path } = page("/");
    await settle();
    await askFromTheFrontDoor(container);
    const offered = deleteRow(container, "ORM");
    await settle();
    const seen = { ...offered, stoppedAtDelete, stopped, path: path() };
    unmount();

    expect(seen).toEqual({
      pressable: true,
      said: i18n.t("sidebar.deleteBody", { title: "ORM" }),
      stoppedAtDelete: false,
      stopped: false,
      path: `/chat/${uuidOf(9)}`,
    });
  });
});
