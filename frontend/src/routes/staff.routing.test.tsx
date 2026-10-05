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
import type { Programme, StudyPlanCourse } from "@/api/catalog";
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
  if (programme !== undefined && path.endsWith("/courses")) return json(PLAN);
  if (programme !== undefined) return json(programme);
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
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Gestione group and /staff", () => {
  it.each<[string, Account, string[][], string]>([
    ["a student", STUDENT, [], "/"],
    // "I miei insegnamenti" arrives with the teacher's own page.
    ["a teacher", TEACHER, [], "/"],
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
      rows: [...container.querySelectorAll<HTMLTableRowElement>("main tbody tr")].map((tr) => text(tr.cells[4])),
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
