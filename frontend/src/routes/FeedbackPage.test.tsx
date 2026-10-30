// @vitest-environment jsdom

/**
 * The superuser's pages of ratings (#218), with the network faked at `fetch`:
 * what the list shows of each rating, and that the page is nobody else's;
 * what it asks the server for as the reader narrows it and turns pages, kept
 * in the address so Back from a rating returns to it; and a rating opened,
 * its comment in its own language, the exchange rated, the earlier ones
 * folded, and the request that produced it.
 */

import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { Citation } from "@/api/contract";
import { FEEDBACK_PAGE_SIZE, type FeedbackDetail, type FeedbackRow } from "@/api/review";
import { SessionContext } from "@/auth/SessionProvider";
import { uuidOf } from "@/test/conversations";
import { mount } from "@/test/mount";
import { codedRefusal } from "@/test/refusal";
import { ThemeProvider } from "@/theme/ThemeProvider";
import FeedbackDetailPage from "./FeedbackDetailPage";
import FeedbackPage from "./FeedbackPage";
import { type Shell, ShellContext } from "./shell";

const ADMIN: Account = {
  id: 1,
  username: "demo-admin",
  locale: "it",
  is_superuser: true,
  roles: [],
  programme: null,
  year_of_study: null,
};

function rated(n: number, changes: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: uuidOf(n),
    rating: "down",
    reason: "incorrect",
    comment: "",
    comment_locale: "",
    updated_at: "2026-10-30T09:30:00Z",
    question: `Domanda ${n}`,
    target: "slides",
    locale: "it",
    ...changes,
  };
}

const ORM = rated(1, { question: "Che cos'è un ORM?", comment: "说错了", comment_locale: "zh" });
const PRAISED = rated(2, {
  rating: "up",
  reason: "",
  target: null,
  locale: "en",
  question: "What is an ORM?",
});

const SLIDE: Citation = {
  marker: "[PPM 3]",
  kind: "slides",
  text: "Un ORM traduce le righe in oggetti.",
  heading_path: ["Persistenza"],
  course: "B028451",
  academic_year: "2025-2026",
  locale: "it",
  score: 0.5,
  source_file: "PPM-07-orm.pdf",
  source_sha256: "ab".repeat(32),
  page: 3,
  url: null,
  fetch_date: null,
};

const DETAIL: FeedbackDetail = {
  id: ORM.id,
  rating: "down",
  reason: "incorrect",
  comment: "说错了",
  comment_locale: "zh",
  created_at: "2026-10-30T09:29:00Z",
  updated_at: "2026-10-30T09:30:00Z",
  question: "E il secondo?",
  answer: {
    text: "Il secondo è Django. [PPM 3]",
    locale: "it",
    complete: true,
    citations: [SLIDE],
    route: { target: "slides", query: "secondo ORM", fresh: false, reason: "corso" },
    search_ms: 2400,
    request_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    created_at: "2026-10-30T09:28:00Z",
  },
  history: [
    { question: "Quali ORM ci sono?", answer: "SQLAlchemy e Django." },
    { question: "E il primo?", answer: "SQLAlchemy." },
  ],
};

/** The ratings the server holds now, newest first. */
let ratings: FeedbackRow[] = [];
/** Each request the pages sent, `METHOD path?query`. */
let asked: string[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

/** `GET /api/admin/feedback` as the server narrows and pages it (apps/qa/feedback_views.py). */
function listed(url: URL): Response {
  const page = Number(url.searchParams.get("page") ?? "1");
  const matching = ratings.filter((each) =>
    (["rating", "reason", "target", "locale"] as const).every((name) => {
      const wanted = url.searchParams.get(name);
      return wanted === null || each[name] === wanted;
    }),
  );
  const start = (page - 1) * FEEDBACK_PAGE_SIZE;
  return json({
    count: matching.length,
    next: start + FEEDBACK_PAGE_SIZE < matching.length ? "next" : null,
    previous: page > 1 ? "previous" : null,
    results: matching.slice(start, start + FEEDBACK_PAGE_SIZE),
  });
}

async function fakeApi(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), "http://localhost");
  asked.push(`GET ${url.pathname}${url.search}`);
  if (url.pathname === "/api/admin/feedback") return listed(url);
  if (url.pathname === `/api/admin/feedback/${DETAIL.id}`) return json(DETAIL);
  return codedRefusal("NOT_FOUND");
}

const SHELL: Shell = {
  programmes: [],
  programmesError: null,
  landing: null,
  root: "programmes",
  back: { to: "/staff/programmes", label: "" },
  setTrail: () => {},
  refreshConversations: () => {},
  setBusy: () => {},
};

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function open(at: string, reader: Account = ADMIN) {
  const router = createMemoryRouter(
    [
      { path: "/staff/feedback", element: <FeedbackPage /> },
      { path: "/staff/feedback/:id", element: <FeedbackDetailPage /> },
    ],
    { initialEntries: [at] },
  );
  const mounted = mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: reader,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          chooseStudies: async () => {},
          forget: () => {},
          recheck: async () => {},
        }}
      >
        <ShellContext value={SHELL}>
          <RouterProvider router={router} />
        </ShellContext>
      </SessionContext>
    </ThemeProvider>,
  );
  await settle();
  return { ...mounted, router };
}

/** What an element says, its parts apart: "IT italiano", not "ITitaliano". */
function words(element: Element): string {
  if (element.children.length === 0) return element.textContent ?? "";
  return [...element.childNodes]
    .map((node) => (node instanceof Element ? words(node) : (node.textContent ?? "").trim()))
    .filter((part) => part !== "")
    .join(" ");
}

/** Each row as the reader sees it: its cells, each a line per part, without a stacked row's label. */
function rows(container: HTMLElement) {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].slice(0, 5).map((cell) => {
      const shown = cell.querySelector(":scope > div");
      if (shown === null) return [];
      return shown.children.length === 0 ? [words(shown)] : [...shown.children].map(words);
    }),
  );
}

/** Chooses `value` in the select of `id`, as the browser's own picker does. */
function pick(id: string, value: string) {
  const select = document.getElementById(id);
  act(() => {
    if (select instanceof HTMLSelectElement) select.value = value;
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function press(container: ParentNode, name: string) {
  const button = [...container.querySelectorAll<HTMLElement>("button")].find(
    (each) => each.textContent === name,
  );
  act(() => button?.click());
}

const RATED = new Intl.DateTimeFormat("it", { dateStyle: "medium", timeStyle: "short" }).format(
  new Date("2026-10-30T09:30:00Z"),
);

beforeEach(() => {
  ratings = [ORM, PRAISED];
  asked = [];
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("the ratings page", () => {
  it("shows each rating's question, thumb, reason and comment, source and language", async () => {
    const { container, unmount } = await open("/staff/feedback");
    const shown = rows(container);
    const count = container.querySelector("header")?.textContent;
    const langs = [...container.querySelectorAll("tbody [lang]")].map((each) => [
      each.textContent,
      each.getAttribute("lang"),
    ]);
    unmount();

    expect({ count, shown, langs }).toEqual({
      count: expect.stringContaining("2 valutazioni"),
      shown: [
        [
          ["Che cos'è un ORM?", `Valutata il ${RATED}`],
          ["Risposta non buona"],
          ["Non è corretta", "说错了"],
          ["Materiale del corso"],
          ["IT", "italiano"],
        ],
        [
          ["What is an ORM?", `Valutata il ${RATED}`],
          ["Buona risposta"],
          ["—"],
          ["—"],
          ["EN", "inglese"],
        ],
      ],
      // The question in the language it was asked in, the comment in its own.
      langs: [
        ["Che cos'è un ORM?", "it"],
        ["说错了", "zh"],
        ["What is an ORM?", "en"],
      ],
    });
  });

  it.each(["/staff/feedback", `/staff/feedback/${DETAIL.id}`])(
    "%s is not found for staff who are not the superuser, who ask the server nothing",
    async (at) => {
      const reader: Account = {
        ...ADMIN,
        is_superuser: false,
        roles: [{ role: "teacher", edition: 5 }],
      };
      const { container, unmount } = await open(at, reader);
      const heading = container.querySelector("h1, h2")?.textContent;
      unmount();

      expect({ heading, asked }).toEqual({ heading: "Non trovato", asked: [] });
    },
  );

  it("asks for what the filters narrow to, from the first page, and keeps it in the address", async () => {
    ratings = Array.from({ length: 60 }, (_, i) =>
      rated(10 + i, { rating: i < 55 ? "down" : "up" }),
    );
    const { container, router, unmount } = await open("/staff/feedback");
    press(container, "Successiva");
    await settle();
    pick("feedback-reason", "incorrect");
    await settle();
    pick("feedback-rating", "down");
    await settle();
    const address = router.state.location.search;
    const count = container.querySelector("header")?.textContent;
    unmount();

    expect({ address, count, asked }).toEqual({
      address: "?rating=down&reason=incorrect",
      count: expect.stringContaining("55 valutazioni"),
      asked: [
        "GET /api/admin/feedback",
        "GET /api/admin/feedback?page=2",
        "GET /api/admin/feedback?reason=incorrect",
        "GET /api/admin/feedback?rating=down&reason=incorrect",
      ],
    });
  });

  it("reads its filters from the address, a value it does not offer as none", async () => {
    const { unmount } = await open("/staff/feedback?locale=fr&target=slides&rating=sideways");
    const chosen = ["feedback-rating", "feedback-target", "feedback-locale"].map(
      (id) => (document.getElementById(id) as HTMLSelectElement | null)?.value,
    );
    unmount();

    expect({ chosen, asked }).toEqual({
      chosen: ["", "slides", ""],
      asked: ["GET /api/admin/feedback?target=slides"],
    });
  });

  it("comes back from a rating with Back to the list as it was left, its row marked", async () => {
    const { container, router, unmount } = await open("/staff/feedback?reason=incorrect");
    act(() => container.querySelector<HTMLElement>("tbody a")?.click());
    await settle();
    const opened = router.state.location.pathname;
    await act(() => router.navigate(-1));
    await settle();
    const marked = [...container.querySelectorAll("tbody tr[data-selected]")].map(
      (row) => row.querySelector("a")?.textContent,
    );
    unmount();

    expect({ opened, marked, asked }).toEqual({
      opened: `/staff/feedback/${ORM.id}`,
      marked: ["Che cos'è un ORM?"],
      asked: [
        "GET /api/admin/feedback?reason=incorrect",
        `GET /api/admin/feedback/${ORM.id}`,
        "GET /api/admin/feedback?reason=incorrect",
      ],
    });
  });
});

describe("a rating opened", () => {
  it("shows the comment in its language, the exchange rated, the earlier ones folded, and its request", async () => {
    const { container, unmount } = await open(`/staff/feedback/${DETAIL.id}`);
    const chips = words(container.querySelector("header div.mt-hair") ?? container);
    const comment = container.querySelector("section p[lang]");
    const folded = container.querySelector("details");
    const article = container.querySelector("article");
    const request = container.querySelector("dl")?.textContent;
    const thumbs = container.querySelectorAll("[aria-pressed]").length;
    unmount();

    expect({
      chips,
      comment: [comment?.textContent, comment?.getAttribute("lang")],
      folded: [folded?.open, folded?.querySelector("summary")?.textContent],
      earlier: [...(folded?.querySelectorAll("li") ?? [])].map((each) => each.textContent),
      question: article?.querySelector("p[lang]")?.textContent,
      answer: article?.textContent?.includes("Il secondo è Django."),
      request,
      thumbs,
    }).toEqual({
      chips: "Risposta non buona Non è corretta Materiale del corso IT italiano",
      comment: ["说错了", "zh"],
      folded: [false, "2 scambi precedenti"],
      earlier: ["Quali ORM ci sono?SQLAlchemy e Django.", "E il primo?SQLAlchemy."],
      question: "E il secondo?",
      answer: true,
      request: "ID della richiesta4bf92f3577b34da6a3ce929d0e0e4736",
      // Read, not rated again.
      thumbs: 0,
    });
  });

  it("is not found once withdrawn", async () => {
    const { container, unmount } = await open(`/staff/feedback/${uuidOf(99)}`);
    const heading = container.querySelector("h1, h2")?.textContent;
    unmount();

    expect(heading).toBe("Non trovato");
  });
});
