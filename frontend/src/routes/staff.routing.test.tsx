// @vitest-environment jsdom

/**
 * The staff pages inside the chat shell, asked of the whole application.
 *
 * As in ChatPage.routing.test.tsx, `App` is mounted behind a memory router
 * with the network faked at `fetch`. The assertions are what a reader of each
 * kind sees: the sidebar's groups and their order, where `/staff` lands, the
 * pages' headings and copy, and the breadcrumb; and what the shell keeps
 * across pages — the conversations it does not fetch again, the drawer a
 * Gestione link closes, the answer that leaving the chat stops.
 */

import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import type { Account } from "@/api/account";
import type { Course, Edition, Programme, StudyPlanCourse } from "@/api/catalog";
import type { ConversationSummary } from "@/api/conversations";
import { SessionContext } from "@/auth/SessionProvider";
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

/** What `GET /api/catalog/programmes` answers each account. */
const SCOPE: Record<string, Programme[]> = {
  "demo-teacher": [],
  "demo-secretariat": [B047],
  "demo-both": [B047, B222],
  "demo-admin": [
    { ...B047, permissions: ["programme.assign_secretariat", "programme.view"] },
    { ...B222, permissions: ["programme.assign_secretariat", "programme.view"] },
  ],
};

let reader: Account = STUDENT;
let conversations: ConversationSummary[] = [];
const asked: string[] = [];
/** Whether the answer stream was told to stop. */
let stopped = false;
/** Secretariat staff revoked during a case, as the server would forget them. */
const revoked = new Set<string>();

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
  const scope = SCOPE[reader.username] ?? [];
  const programme = scope.find((p) => path.startsWith(`/api/catalog/programmes/${p.code}`));
  if (method === "GET" && path === "/api/conversations") return json(conversations);
  if (method === "POST" && path === "/api/ask") {
    conversations = [{ id: 9, locale: "it", created_at: "2026-10-05T09:00:00Z", title: "q" }];
    return endlessAnswer(init.signal);
  }
  if (path === "/api/catalog/programmes") return json(scope);
  // A teacher views no programme, so no course.
  const course = [PPM, SHARED].find((c) => path === `/api/catalog/courses/${c.code}`);
  if (course !== undefined && scope.length > 0) return json(course);
  if (path === "/api/catalog/editions") return json(EDITIONS);
  if (path.startsWith("/api/catalog/editions?course=")) {
    return json(EDITIONS.filter((e) => path.endsWith(`=${e.course.code}`)));
  }
  const one = EDITIONS.find((e) => path === `/api/catalog/editions/${e.id}`);
  if (one !== undefined) {
    // Secretariat staff may assign a teacher; the teacher may not.
    const assigns = scope.length > 0 ? ["edition.assign_teacher"] : [];
    return json({ ...one, permissions: [...assigns, ...one.permissions] });
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

function Pathname() {
  return <output>{useLocation().pathname}</output>;
}

function page(path: string): Mounted {
  return mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: reader,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          forget: () => {},
        }}
      >
        <MemoryRouter initialEntries={[path]}>
          <App />
          <Pathname />
        </MemoryRouter>
      </SessionContext>
    </ThemeProvider>,
  );
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
  revoked.clear();
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
  ])("for %s", async (_, who, items, lands) => {
    reader = who;
    const { container, unmount } = page("/staff");
    await settle();
    const seen = {
      items: gestione(container),
      lands: text(container.querySelector("output")),
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
      ]),
      crumbs: crumbs(container),
    };
    unmount();

    expect(seen).toEqual({
      title: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE",
      cards: ["INGEGNERIA INFORMATICAB047"],
      note: true,
      editions: [
        ["/staff/editions/5?programme=B047", "—"],
        ["/staff/editions/4?programme=B047", "Corrente"],
      ],
      crumbs: [
        "Corso di laurea",
        "B047 · INGEGNERIA INFORMATICA →",
        "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE (current)",
      ],
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
    const { container, unmount } = page("/staff");
    await settle();
    const seen = {
      path: text(container.querySelector("output")),
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

describe("a write from a page", () => {
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
    };
    unmount();

    expect(seen).toEqual({ left: true, toast: true, focused: "Assegna segreteria" });
  });
});

describe("the shell across pages", () => {
  it("does not fetch the conversations again between the chat and a staff page", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/");
    await settle();
    click(container.querySelector<HTMLAnchorElement>('aside nav[aria-label="Gestione"] a'));
    await settle();
    const onStaff = text(container.querySelector("output"));
    click(container.querySelector<HTMLAnchorElement>('aside a[href="/"]'));
    await settle();
    const back = text(container.querySelector("output"));
    unmount();

    expect([onStaff, back]).toEqual(["/staff/programmes/B047", "/"]);
    expect(asked.filter((call) => call === "GET /api/conversations")).toHaveLength(1);
  });

  it("closes the narrow-screen drawer when a Gestione link is followed", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/");
    await settle();
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Apri le conversazioni"]'));
    const drawer = document.body.querySelector('[role="dialog"]');
    click(drawer?.querySelector<HTMLAnchorElement>('nav[aria-label="Gestione"] a'));
    await settle();
    const seen = [
      Boolean(drawer),
      document.body.querySelector('[role="dialog"]'),
      text(container.querySelector("output")),
    ];
    unmount();

    expect(seen).toEqual([true, null, "/staff/programmes/B047"]);
  });

  it("stops an answer when the reader leaves for a staff page, and frees its delete", async () => {
    reader = SECRETARIAT;
    const { container, unmount } = page("/");
    await settle();
    // A suggestion asks at once, which is the shortest way to ask.
    click(container.querySelector<HTMLButtonElement>("main button"));
    await settle();
    const deleteOf9 = () =>
      container.querySelector<HTMLButtonElement>('aside button[aria-label="Elimina «q»"]');
    const whileAnswering = deleteOf9()?.disabled;
    click(container.querySelector<HTMLAnchorElement>('aside nav[aria-label="Gestione"] a'));
    await settle();
    const afterLeaving = deleteOf9()?.disabled;
    unmount();

    expect([whileAnswering, stopped, afterLeaving]).toEqual([true, true, false]);
  });
});
