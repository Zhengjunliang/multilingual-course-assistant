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
import { type Mounted, mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

const B047: Programme = {
  code: "B047",
  name: "INGEGNERIA INFORMATICA",
  locale: "it",
  curricula: ["TECNICO APPLICATIVO", "TECNICO SCIENTIFICO"],
  course_count: 1,
  secretariat: [{ id: 2, username: "demo-secretariat" }],
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
    is_current: current,
    teachers: teachers.map((username, index) => ({ id: index + 10, username })),
    permissions: ["edition.set_current", "edition.view"],
    can_set_current: true,
  };
}

/** PPM's editions, the newer first as the server lists them; the teacher teaches both. */
const EDITIONS = [
  edition(5, "2025-2026", false, ["demo-colleague", "demo-teacher"]),
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
/** Whether a switch by the reader would pass, as `can_set_current` says per edition. */
let switchable = true;
/** Holds every read of one edition until it settles, as a slow server would. */
let held: Promise<void> | null = null;

/** An edition as the server would answer it now. */
function served(e: Edition): Edition {
  return {
    ...e,
    can_set_current: e.can_set_current && switchable,
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
    conversation_id: 9,
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
      { id: 9, locale: "it", created_at: "2026-10-05T09:00:00Z", title: "q" },
      ...conversations,
    ];
    return endlessAnswer(init.signal);
  }
  if (method === "DELETE" && path.startsWith("/api/conversations/")) {
    stoppedAtDelete = stopped;
    if (deleteRefused) return json({ detail: "Server error." }, 500);
    const id = Number(path.slice("/api/conversations/".length));
    conversations = conversations.filter((listed) => listed.id !== id);
    return new Response(null, { status: 204 });
  }
  if (path === "/api/catalog/programmes") {
    if (failures > 0) {
      failures -= 1;
      return json({ detail: { message: "Server error.", code: "error" } }, 500);
    }
    return json(scope);
  }
  // A teacher views no programme, so no course.
  const course = [PPM, SHARED].find((c) => path === `/api/catalog/courses/${c.code}`);
  if (course !== undefined && scope.length > 0) return json(course);
  if (path === "/api/catalog/editions") return json(EDITIONS.map(served));
  if (path.startsWith("/api/catalog/editions?course=")) {
    return json(EDITIONS.filter((e) => path.endsWith(`=${e.course.code}`)).map(served));
  }
  if (method === "DELETE" && path.startsWith("/api/catalog/editions/")) {
    revoked.add(path.slice(path.lastIndexOf("/") + 1));
    return new Response(null, { status: 204 });
  }
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
  return json({ detail: { message: "Not found.", code: "not_found" } }, 404);
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
  };
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

/** The links of the sidebar's Gestione group, as label → address. */
function gestione(root: ParentNode) {
  const nav = root.querySelector('nav[aria-label="Gestione"]');
  return [...(nav?.querySelectorAll("a") ?? [])].map((a) => [text(a), a.getAttribute("href")]);
}

function crumbs(container: HTMLElement) {
  return [...container.querySelectorAll('header nav[aria-label="Percorso"] li')].map((li) => {
    const link = li.querySelector("a");
    const current = li.querySelector('[aria-current="page"]') !== null;
    return `${text(li)}${link ? " →" : ""}${current ? " (current)" : ""}`;
  });
}

beforeEach(() => {
  conversations = [{ id: 7, locale: "it", created_at: "2026-10-04T10:00:00Z", title: "ORM" }];
  asked.length = 0;
  stopped = false;
  stoppedAtDelete = null;
  deleteRefused = false;
  lateList = null;
  revoked.clear();
  failures = 0;
  switchable = true;
  held = null;
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Gestione group and /staff", () => {
  it.each<[string, Account, string[][], string]>([
    ["a student", STUDENT, [], "/"],
    ["a teacher", TEACHER, [["I miei insegnamenti", "/staff/mine"]], "/staff/mine"],
    [
      "one programme's secretariat",
      SECRETARIAT,
      [["Corso di laurea", "/staff/programmes/B047"]],
      "/staff/programmes/B047",
    ],
    [
      "two programmes' secretariat",
      BOTH,
      [["Corsi di laurea", "/staff/programmes"]],
      "/staff/programmes",
    ],
    ["the superuser", ADMIN, [["Corsi di laurea", "/staff/programmes"]], "/staff/programmes"],
    // The programme first, and `/staff` waits for the list to know it.
    [
      "secretariat staff who teach",
      DUAL,
      [
        ["Corso di laurea", "/staff/programmes/B047"],
        ["I miei insegnamenti", "/staff/mine"],
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
      // The heading over the conversations is there only when Gestione is.
      heading: text(container.querySelector('nav[aria-label="Le tue conversazioni"] p')),
      programmesAsked: asked.includes("GET /api/catalog/programmes"),
    };
    unmount();

    expect(seen).toEqual({
      items,
      lands,
      heading: items.length > 0 ? "Le tue conversazioni" : null,
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
      aside?.querySelector('nav[aria-label="Le tue conversazioni"]'),
    ];
    const following = order
      .slice(1)
      .map((node, i) => Boolean(node && order[i]?.compareDocumentPosition(node) === 4));
    unmount();

    expect(following).toEqual([true, true]);
  });
});

describe("signing in", () => {
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
      rows: [...container.querySelectorAll<HTMLTableRowElement>("main tbody tr")].map((tr) =>
        text(tr.cells[4]),
      ),
      crumbs: crumbs(container),
    };
    unmount();

    expect(seen).toEqual({
      title: "Corsi di laurea",
      columns: ["Codice", "Nome", "Curriculum", "Insegnamenti", "Segreteria didattica", "Apri"],
      links: ["/staff/programmes/B047", "/staff/programmes/B222"],
      rows: ["demo-secretariat", "Nessuno"],
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
    const body = container.textContent ?? "";
    const seen = {
      title: text(container.querySelector("main h1")),
      crumbs: crumbs(container),
      group: text(container.querySelector('main th[scope="colgroup"]')),
      footnote: body.includes("Solo l'amministratore assegna la segreteria didattica."),
    };
    unmount();

    expect(seen).toEqual({
      title: "INGEGNERIA INFORMATICA",
      crumbs: path,
      group: "3° anno · 1 insegnamento",
      footnote,
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
      editions: [...container.querySelectorAll<HTMLTableRowElement>("main tbody tr")].map((tr) => [
        tr.querySelector("a")?.getAttribute("href"),
        text(tr.cells[1]),
        text(tr.cells[2]),
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
      cards: ["INGEGNERIA INFORMATICAB047"],
      note: true,
      editions: [
        ["/staff/editions/5?programme=B047", "—", "demo-colleague, demo-teacher"],
        ["/staff/editions/4?programme=B047", "Corrente", "demo-teacher"],
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
      cards: ["INGEGNERIA INFORMATICAB047", "INGEGNERIA GESTIONALEB222"],
      shared: true,
    });
  });

  it("lists a teacher's own courses, newest year first", async () => {
    reader = TEACHER;
    const { container, unmount, path } = page("/staff");
    await settle();
    const seen = {
      path: path(),
      cards: [...container.querySelectorAll("main h2")].map(text),
      rows: [...container.querySelectorAll("main li")].map((li) => [
        li.querySelector("a")?.getAttribute("href"),
        text(li),
      ]),
    };
    unmount();

    expect(seen).toEqual({
      path: "/staff/mine",
      cards: ["PROGETTAZIONE E PRODUZIONE MULTIMEDIALE"],
      rows: [
        ["/staff/editions/5", "2025-2026demo-colleague, demo-teacherImposta come corrente"],
        ["/staff/editions/4", "2024-2025Correntedemo-teacher"],
      ],
    });
  });

  it("offers no switch the server would refuse", async () => {
    reader = TEACHER;
    switchable = false;
    const { container, unmount } = page("/staff/mine");
    await settle();
    const offered = (container.textContent ?? "").includes("Imposta come corrente");
    unmount();

    expect(offered).toBe(false);
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
      true,
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
      false,
    ],
  ])("shows an edition's teachers to %s", async (_, who, path, trail, footnote) => {
    reader = who;
    const { container, unmount } = page(path);
    await settle();
    const seen = {
      people: [...container.querySelectorAll("main ul li")].map(text),
      crumbs: crumbs(container),
      footnote: (container.textContent ?? "").includes(
        "Solo la segreteria didattica e l'amministratore assegnano i docenti.",
      ),
    };
    unmount();

    expect(seen).toEqual({
      // The reader is marked as themselves; whoever may assign gets a "Revoca" per row.
      people:
        who === TEACHER
          ? ["demo-colleague", "demo-teachertu"]
          : ["demo-colleagueRevoca", "demo-teacherRevoca"],
      crumbs: trail,
      footnote,
    });
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
  it("offers to read again, and shows the page once the read succeeds", async () => {
    reader = ADMIN;
    // The shell's own read of the list, then the page's.
    failures = 2;
    const { container, unmount } = page("/staff/programmes");
    await settle();
    const said = text(container.querySelector('main [role="alert"]'));
    // A failed read is not a page that does not exist.
    const trail = crumbs(container);
    const retry = [...container.querySelectorAll<HTMLButtonElement>("main button")].find(
      (button) => button.textContent === "Riprova",
    );
    act(() => retry?.click());
    await settle();
    const title = text(container.querySelector("main h1"));
    unmount();

    expect([said, trail, title]).toEqual([
      `${i18n.t("staff.loadFailed")}Riprova`,
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
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Revoca demo-secretariat"]')
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
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Apri le conversazioni"]'));
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

/** A suggestion asks at once, which is the shortest way to ask; the answer never ends. */
async function askFromTheFrontDoor(container: HTMLElement) {
  click(container.querySelector<HTMLButtonElement>("main button"));
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
      row: container.querySelector('aside a[href="/c/9"]'),
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
      row: container.querySelector('aside a[href="/c/9"]') !== null,
      said: document.body.textContent?.includes(i18n.t("sidebar.deleteFailed")),
    };
    unmount();

    expect(seen).toEqual({ stopped: false, path: "/c/9", row: true, said: true });
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
    const row = container.querySelector('aside a[href="/c/9"]');
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
      path: "/c/9",
    });
  });
});
