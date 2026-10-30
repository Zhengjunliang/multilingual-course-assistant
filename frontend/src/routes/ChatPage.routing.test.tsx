// @vitest-environment jsdom

/**
 * Where the chat page leaves the reader, asked of the whole application.
 *
 * The URL is the page's state (ChatPage.tsx says why), and the bugs worth
 * catching live between two effects that both read it in the same commit — no
 * test of one component in isolation sees them. So this mounts the app's routes
 * in a memory router and fakes the network at `fetch`, the HTTP boundary, with a
 * small in-memory server. The assertions are about what a reader sees: the
 * path, and which conversations the sidebar lists.
 */

import { act, type ReactNode, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "@/App";
import type { Account } from "@/api/account";
import type { ConversationDetail, ConversationSummary } from "@/api/conversations";
import type { ScopeCourse } from "@/api/scope";
import { SessionContext, SessionProvider } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { summary, uuidOf } from "@/test/conversations";
import { type Mounted, mount } from "@/test/mount";
import { codedRefusal, REQUEST_ID } from "@/test/refusal";
import { ThemeProvider } from "@/theme/ThemeProvider";

const ID_7 = uuidOf(7);
const ID_8 = uuidOf(8);
const ID_9 = uuidOf(9);

const STORED_ROW = summary({
  id: ID_7,
  created_at: "2026-09-28T10:00:00Z",
  title: "Che cos'è un ORM?",
});

const STORED: ConversationDetail = {
  ...STORED_ROW,
  messages: [
    {
      id: uuidOf(1),
      role: "user",
      text: "Che cos'è un ORM?",
      locale: "it",
      complete: true,
      citations: [],
      route: null,
      search_ms: null,
      created_at: STORED_ROW.created_at,
    },
    {
      id: uuidOf(2),
      role: "assistant",
      text: "Un ORM mappa le tabelle in classi.",
      locale: "it",
      complete: true,
      citations: [],
      route: null,
      search_ms: null,
      created_at: STORED_ROW.created_at,
    },
  ],
  answering: null,
  added_editions: [],
};

/** What `GET /api/conversations` answers; a question on `/` adds to it, as the server does. */
let conversations: ConversationSummary[] = [];
/** Whether `DELETE` fails, as a server error would. */
let deleteFails = false;
/** Whether `GET /api/conversations` fails, as a dropped connection would. */
let listFails = false;
/** Whether reading conversation 7 fails, as a server error would. */
let readFails = false;
/** How many `PATCH`es fail before one goes through, as a server error would. */
let pinFailures = 0;
/** Whether `POST /api/ask` is refused, as a server error would. */
let askFails = false;
/** The answer a worker is writing into conversation 7, its question still waiting; `null` for none. */
let writing: string | null = null;
/** Every request made, as `METHOD path`. */
let requested: string[] = [];
/** How many times the page asked the session provider who is signed in. */
let rechecked = 0;
/**
 * Whether the server still holds the reader's session, for the tests that
 * mount the real provider. Without one it refuses everything but `me` as
 * unauthenticated, the sign-out included.
 */
let signedIn = true;
/** Whose that session is: the reader's, unless a test signs another account in. */
let sessionOf: Account | null = null;
/** What `GET /api/scope` answers: no course, unless a test gives the reader some. */
let scope: ScopeCourse[] = [];
/** The editions conversation 7 adds, as its stored row holds them. */
let storedAdded: number[] = [];
/** The bodies `POST /api/ask` was sent, parsed. */
let asked: Record<string, unknown>[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** An answer stream in the framing `api/sse.ts` reads: `queued`, `start`, then `end`. */
function answerStream(conversationId: string | null, question: string, answerId: string): Response {
  const queued = { answer_id: answerId, conversation_id: conversationId, question };
  const start = {
    question,
    conversation_id: conversationId,
    locale: "it",
    route: { target: "unifi_web", query: question, fresh: false, reason: "campus question" },
    citations: [],
    search_ms: 1200,
  };
  const body = [
    `event: queued\ndata: ${JSON.stringify(queued)}\n\n`,
    `event: start\ndata: ${JSON.stringify(start)}\n\n`,
    "event: end\ndata: {}\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  requested.push(`${method} ${path}`);
  if (path === "/api/auth/me") {
    return json({ authenticated: signedIn, user: signedIn ? (sessionOf ?? STUDENT) : null });
  }
  if (method === "POST" && path === "/api/auth/logout") {
    if (!signedIn) return codedRefusal("UNAUTHENTICATED");
    signedIn = false;
    return new Response(null, { status: 204 });
  }
  if (!signedIn) return codedRefusal("UNAUTHENTICATED");
  if (method === "GET" && path === "/api/conversations") {
    return listFails ? codedRefusal("INTERNAL") : json(conversations);
  }
  if (method === "GET" && path === `/api/conversations/${ID_7}`) {
    return readFails
      ? codedRefusal("INTERNAL")
      : json({ ...STORED, answering: writing, added_editions: storedAdded });
  }
  if (method === "GET" && writing !== null && path === `/api/answers/${writing}/events`) {
    return answerStream(ID_7, "E un DAO?", writing);
  }
  if (method === "DELETE" && path.startsWith("/api/conversations/")) {
    if (deleteFails) return codedRefusal("INTERNAL");
    const id = path.slice("/api/conversations/".length);
    if (!conversations.some((row) => row.id === id)) return codedRefusal("NOT_FOUND");
    conversations = conversations.filter((row) => row.id !== id);
    return new Response(null, { status: 204 });
  }
  if (method === "PATCH" && path.startsWith("/api/conversations/")) {
    if (pinFailures > 0) {
      pinFailures -= 1;
      return codedRefusal("INTERNAL");
    }
    const id = path.slice("/api/conversations/".length);
    const row = conversations.find((listed) => listed.id === id);
    if (row === undefined) return codedRefusal("NOT_FOUND");
    const { pinned } = JSON.parse(String(init.body)) as { pinned: boolean };
    // In the server's order: pinned rows first, each group by its last message.
    conversations = conversations
      .map((listed) => (listed.id === id ? { ...listed, pinned } : listed))
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || b.last_message_at.localeCompare(a.last_message_at),
      );
    return json({ ...row, pinned });
  }
  if (method === "GET" && path === "/api/scope") return json(scope);
  if (method === "POST" && path === "/api/ask") {
    if (askFails) return codedRefusal("INTERNAL");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    asked.push(body);
    const { question, history } = body as { question: string; history?: unknown };
    // A visitor's question is filed nowhere, as the server has it.
    if (history !== undefined) return answerStream(null, question, uuidOf(31));
    conversations = [
      summary({ id: ID_9, created_at: "2026-09-29T09:00:00Z", title: question }),
      ...conversations,
    ];
    return answerStream(ID_9, question, uuidOf(31));
  }
  return codedRefusal("NOT_FOUND");
}

const STUDENT: Account = {
  id: 1,
  username: "junliang",
  locale: "it",
  is_superuser: false,
  roles: [],
  programme: null,
  year_of_study: null,
};

interface Page extends Mounted {
  /** Where the router is, as the address bar shows it. */
  path: () => string;
  /** What the navigation that got there carried, as the login page reads it. */
  state: () => unknown;
}

function page(path: string, account: Account | null = STUDENT): Page {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const mounted = mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          chooseStudies: async () => {},
          forget: () => {},
          recheck: async () => {
            rechecked += 1;
          },
        }}
      >
        <RouterProvider router={router} />
      </SessionContext>
    </ThemeProvider>,
  );
  return {
    ...mounted,
    path: () => router.state.location.pathname,
    state: () => router.state.location.state,
  };
}

/** Lets every pending fetch, body read and state update land. */
async function settle() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function openNewConversation(container: HTMLElement) {
  act(() => container.querySelector<HTMLAnchorElement>('a[href="/"]')?.click());
}

/** Types into the composer: React hears the value set past its own setter. */
function typeInto(container: HTMLElement, text: string) {
  const field = container.querySelector<HTMLTextAreaElement>("#question");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, text);
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Types a question into the composer under the entry and presses send. */
function askFromTheFrontDoor(container: HTMLElement) {
  typeInto(container, "Quali sono le scadenze per l'iscrizione?");
  act(() => container.querySelector<HTMLButtonElement>("button[type='submit']")?.click());
}

/**
 * Ends the entry's `recede`. A browser sends `animationend`; jsdom has no
 * `AnimationEvent`, and React then listens for the prefixed name instead, so
 * both are sent and React hears one of them.
 */
function finishReceding(container: HTMLElement) {
  act(() => {
    for (const name of ["animationend", "webkitAnimationEnd"]) {
      const done = Object.assign(new Event(name, { bubbles: true }), { animationName: "recede" });
      container.querySelector(".recede")?.dispatchEvent(done);
    }
  });
}

/** Deletes a conversation from its sidebar row, through the confirmation alert dialog. */
function deleting(title: string) {
  return (container: HTMLElement) => {
    const label = i18n.t("sidebar.delete", { title });
    const row = [...container.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (button) => button.getAttribute("aria-label") === label,
    );
    act(() => row?.click());
    // The dialog is portalled to the body, outside the container.
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((button) => button.textContent === i18n.t("sidebar.deleteConfirm"));
    act(() => confirm?.click());
  };
}

const OTHER = summary({
  id: ID_8,
  created_at: "2026-09-27T10:00:00Z",
  title: "Quando scadono le tasse?",
});

// What a test types and does not send is kept for the tab (draft.ts), and
// every test in this file runs in the same one.
afterEach(() => {
  sessionStorage.clear();
});

describe("the chat page's address", () => {
  beforeEach(() => {
    conversations = [STORED_ROW, OTHER];
    deleteFails = false;
    askFails = false;
    readFails = false;
    writing = null;
    vi.stubGlobal("fetch", fakeApi);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface Case {
    name: string;
    from: string;
    step: (container: HTMLElement) => void;
    lands: string;
    /** Act before the opened conversation has come back from the server. */
    early?: boolean;
    /** The server refuses the delete. */
    failing?: boolean;
    /** Deleted on the server, from another tab, after this page listed it. */
    deletedElsewhere?: string;
    /** A sidebar row that must be gone afterwards. */
    gone?: string;
    /** A sidebar row that must still be there afterwards. */
    kept?: string;
    /** A request the step must not cause. */
    unrequested?: string;
  }

  it.each<Case>([
    {
      name: "opening a new conversation",
      from: `/chat/${ID_7}`,
      step: openNewConversation,
      lands: "/",
    },
    {
      name: "leaving a conversation before it loaded",
      from: `/chat/${ID_7}`,
      step: openNewConversation,
      lands: "/",
      early: true,
    },
    {
      name: "asking on / moves to the new conversation's address",
      from: "/",
      step: askFromTheFrontDoor,
      lands: `/chat/${ID_9}`,
      // A page rebuilt by the move would read the conversation it is still
      // writing, and drop the answer on screen for what the server has so far.
      unrequested: `GET /api/conversations/${ID_9}`,
    },
    {
      name: "deleting the open conversation",
      from: `/chat/${ID_7}`,
      step: deleting(STORED.title),
      lands: "/",
      gone: `/chat/${ID_7}`,
    },
    {
      name: "deleting another conversation",
      from: `/chat/${ID_7}`,
      step: deleting(OTHER.title),
      lands: `/chat/${ID_7}`,
      gone: `/chat/${ID_8}`,
    },
    {
      name: "a delete the server refuses",
      from: `/chat/${ID_7}`,
      step: deleting(STORED.title),
      lands: `/chat/${ID_7}`,
      failing: true,
      kept: `/chat/${ID_7}`,
    },
    {
      name: "deleting a conversation another tab deleted",
      from: `/chat/${ID_7}`,
      step: deleting(STORED.title),
      lands: "/",
      deletedElsewhere: ID_7,
      gone: `/chat/${ID_7}`,
    },
  ])("$name lands on $lands, and stays there", async (scenario) => {
    const { from, step, lands, early, failing, deletedElsewhere, gone, kept, unrequested } =
      scenario;
    deleteFails = failing === true;
    const { container, unmount, path } = page(from);
    if (!early) await settle();
    if (deletedElsewhere !== undefined) {
      conversations = conversations.filter((listed) => listed.id !== deletedElsewhere);
    }

    const before = requested.length;
    step(container);
    await settle();
    const landed = path();
    // A second round: a bounce is an effect reacting to the first landing.
    await settle();
    const stayed = path();
    const row = (href: string) => container.querySelector(`aside a[href="${href}"]`);
    const goneRow = gone === undefined ? null : row(gone);
    const keptRow = kept === undefined ? undefined : row(kept);
    const saidFailed = document.body.textContent?.includes(i18n.t("sidebar.deleteFailed"));
    const unwanted = unrequested !== undefined && requested.slice(before).includes(unrequested);
    unmount();

    expect(landed).toBe(lands);
    expect(stayed).toBe(lands);
    // The deleted row is off the refreshed sidebar, which is also what proves
    // the step found its button: a missed click would leave it there.
    expect(goneRow).toBeNull();
    expect(keptRow).not.toBeNull();
    // A refused delete says so, which a missed click would not; nothing else
    // ever does.
    expect(saidFailed).toBe(failing === true);
    expect(unwanted).toBe(false);
  });

  it("clears a first question refused before it named a conversation, when a new one is opened", async () => {
    // Refused before `start`, the question was filed under no conversation,
    // so the address stayed `/`; a new conversation is `/` again.
    askFails = true;
    const { container, path, unmount } = page("/");
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    finishReceding(container);
    const refused = { thread: container.querySelector("article") !== null, at: path() };

    openNewConversation(container);
    await settle();
    const opened = { thread: container.querySelector("article") !== null, at: path() };
    unmount();

    expect({ refused, opened }).toEqual({
      refused: { thread: true, at: "/" },
      opened: { thread: false, at: "/" },
    });
  });

  it("stands the entry back at once when a new conversation is opened while it recedes", async () => {
    // Otherwise the entry would fade out to its end and jump back.
    askFails = true;
    const { container, unmount } = page("/");
    await settle();
    askFromTheFrontDoor(container);
    const receding = container.querySelector(".recede") !== null;

    openNewConversation(container);
    await settle();
    const after = container.querySelector(".recede") !== null;
    unmount();

    expect({ receding, after }).toEqual({ receding: true, after: false });
  });

  it("reads back an answer that was waiting for a worker, and lists its conversation again once it ends", async () => {
    // The list was read before the question's rows were written, so it is
    // behind until the answer ends.
    writing = uuidOf(32);
    const before = requested.length;
    const { container, unmount } = page(`/chat/${ID_7}`);
    await settle();
    const asked = container.querySelector("main")?.textContent?.includes("E un DAO?");
    const lists = requested.slice(before).filter((call) => call === "GET /api/conversations");
    unmount();

    expect({ asked, lists: lists.length }).toEqual({ asked: true, lists: 2 });
  });

  it.each([
    ["one gone, as not available", `/chat/${uuidOf(99)}`, false, i18n.t("sidebar.unreadable")],
    [
      "one that failed to load, by why, with its reference",
      `/chat/${ID_7}`,
      true,
      `${i18n.t("errors.INTERNAL")}INTERNAL · rif. ${REQUEST_ID}`,
    ],
  ])(
    "says of a conversation it cannot open %s, offering no composer",
    async (_, path, fails, said) => {
      readFails = fails;
      const { container, unmount } = page(path);
      await settle();
      const text = container.querySelector("main")?.textContent;
      const composer = container.querySelector("#question");
      unmount();

      expect({ text, composer }).toEqual({ text: said, composer: null });
    },
  );
});

describe("pinning from the sidebar", () => {
  beforeEach(() => {
    conversations = [STORED_ROW, OTHER];
    listFails = false;
    pinFailures = 0;
    requested = [];
    vi.stubGlobal("fetch", fakeApi);
  });

  afterEach(() => {
    listFails = false;
    pinFailures = 0;
    vi.unstubAllGlobals();
  });

  const title = "Quando scadono le tasse?";
  const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
  const group = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll(`aside nav[aria-label="${label}"] a`)].map((row) =>
      row.getAttribute("href"),
    );

  it("moves a row to «Fissate» once the server has pinned it, and back, the focus with it", async () => {
    const { container, unmount } = page("/");
    await settle();

    const pin = button(container, i18n.t("sidebar.pin", { title }));
    act(() => {
      pin?.focus();
      pin?.click();
    });
    await settle();
    const pinned = group(container, "Fissate");
    const focusedOnUnpin = document.activeElement?.getAttribute("aria-label");

    act(() => button(container, i18n.t("sidebar.unpin", { title }))?.click());
    await settle();
    const recent = group(container, "Recenti");
    const fixed = container.querySelector('aside nav[aria-label="Fissate"]');
    unmount();

    expect(requested.filter((line) => line.startsWith("PATCH"))).toEqual([
      `PATCH /api/conversations/${ID_8}`,
      `PATCH /api/conversations/${ID_8}`,
    ]);
    expect(pinned).toEqual([`/chat/${ID_8}`]);
    expect(focusedOnUnpin).toBe(i18n.t("sidebar.unpin", { title }));
    expect(recent).toEqual([`/chat/${ID_7}`, `/chat/${ID_8}`]);
    expect(fixed).toBeNull();
  });

  it("can be pressed again when the list that would have moved the row never came", async () => {
    const { container, unmount } = page("/");
    await settle();

    listFails = true;
    act(() => button(container, i18n.t("sidebar.pin", { title }))?.click());
    await settle();
    const waiting = button(container, i18n.t("sidebar.pin", { title }))?.getAttribute(
      "aria-disabled",
    );
    listFails = false;
    act(() => button(container, i18n.t("sidebar.pin", { title }))?.click());
    await settle();
    const pinned = group(container, "Fissate");
    unmount();

    expect(waiting).toBeNull();
    expect(pinned).toEqual([`/chat/${ID_8}`]);
  });

  it("says a failed pin in a toast naming the conversation, whose «Riprova» pins it", async () => {
    const { container, unmount } = page("/");
    await settle();

    pinFailures = 1;
    act(() => button(container, i18n.t("sidebar.pin", { title }))?.click());
    await settle();
    const toast = document.body.querySelector("[data-sonner-toast]");
    const said = toast?.textContent;
    const retry = [...(toast?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === i18n.t("sidebar.retry"),
    );
    act(() => retry?.click());
    await settle();
    const pinned = group(container, "Fissate");
    unmount();

    expect(said).toContain(i18n.t("sidebar.pinFailed"));
    expect(said).toContain(title);
    expect(pinned).toEqual([`/chat/${ID_8}`]);
  });

  it("hands the focus to «Nuova conversazione» when the row was deleted in another tab", async () => {
    const { container, unmount } = page("/");
    await settle();

    conversations = [STORED_ROW];
    const pin = button(container, i18n.t("sidebar.pin", { title }));
    act(() => {
      pin?.focus();
      pin?.click();
    });
    await settle();
    const rows = group(container, "Recenti");
    const focused = document.activeElement?.textContent;
    unmount();

    expect(rows).toEqual([`/chat/${ID_7}`]);
    expect(focused).toBe(i18n.t("sidebar.new"));
  });
});

describe("a visitor's addresses", () => {
  beforeEach(() => {
    conversations = [];
    requested = [];
    rechecked = 0;
    askFails = false;
    vi.stubGlobal("fetch", fakeApi);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the chat on /, with no list of conversations and the way to an account", async () => {
    const { container, unmount, path } = page("/", null);
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    const landed = path();
    const sidebar = container.querySelector("aside");
    const links = [...container.querySelectorAll("header a")].map((a) => a.getAttribute("href"));
    unmount();

    // Asked, answered, and still on /: a visitor's question names no conversation.
    expect(landed).toBe("/");
    expect(sidebar).toBeNull();
    expect(links).toEqual(["/login"]);
    expect(requested).toEqual(["POST /api/ask"]);
    // Signed in from another tab meanwhile, the next question would be refused.
    expect(rechecked).toBe(1);
  });

  it("keeps the entry while it recedes after the first question, then shows the thread", async () => {
    const { container, unmount } = page("/", null);
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    const receding = {
      recede: container.querySelector(".recede") !== null,
      cat: container.querySelector("[data-living-mascot]") !== null,
    };
    // A browser sends `animationend`. jsdom has no `AnimationEvent`, and React
    // then listens for the prefixed name instead, so both are sent; React
    // hears one of them.
    act(() => {
      for (const name of ["animationend", "webkitAnimationEnd"]) {
        const done = Object.assign(new Event(name, { bubbles: true }), { animationName: "recede" });
        container.querySelector(".recede")?.dispatchEvent(done);
      }
    });
    const after = {
      recede: container.querySelector(".recede") !== null,
      cat: container.querySelector("[data-living-mascot]") !== null,
    };
    unmount();

    expect({ receding, after, requested }).toEqual({
      receding: { recede: true, cat: true },
      after: { recede: false, cat: false },
      requested: ["POST /api/ask"],
    });
  });

  it("says a first question refused while the entry recedes, in a region that was there before", async () => {
    // A screen reader hears a live region change, and not reliably one that
    // is inserted with its words already in it (MDN, ARIA live regions); the
    // thread, and every turn in it, mounts only once the entry has gone.
    askFails = true;
    const { container, unmount } = page("/", null);
    await settle();
    const region = container.querySelector('p[role="status"]');

    const before = region?.textContent;
    askFromTheFrontDoor(container);
    await settle();
    const receding = container.querySelector(".recede") !== null;
    const said = region?.textContent;
    finishReceding(container);
    const kept = container.querySelector('p[role="status"]') === region;
    unmount();

    expect({ before, receding, said, kept }).toEqual({
      before: "",
      receding: true,
      said: i18n.t("errors.INTERNAL"),
      kept: true,
    });
  });

  it("keeps what is typed while the entry recedes, and the focus with it", async () => {
    const { container, unmount } = page("/", null);
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    const field = () => container.querySelector<HTMLTextAreaElement>("#question");
    act(() => {
      field()?.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field(), "e la biblioteca?");
      field()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      for (const name of ["animationend", "webkitAnimationEnd"]) {
        const done = Object.assign(new Event(name, { bubbles: true }), { animationName: "recede" });
        container.querySelector(".recede")?.dispatchEvent(done);
      }
    });
    const after = {
      entry: container.querySelector("[data-living-mascot]") !== null,
      typed: field()?.value,
      focused: document.activeElement === field(),
    };
    unmount();

    expect(after).toEqual({ entry: false, typed: "e la biblioteca?", focused: true });
  });

  it("has no new conversation in its thread: a reload is the way to one", async () => {
    const { container, unmount } = page("/", null);
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    finishReceding(container);
    const thread = container.querySelector("main")?.textContent ?? "";
    const buttons = [...container.querySelectorAll("main button")].map((b) => b.textContent);
    unmount();

    expect(thread).toContain("Quali sono le scadenze per l'iscrizione?");
    expect(buttons).not.toContain(i18n.t("sidebar.new"));
  });

  it("shows the thread at once with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("reduce"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { container, unmount } = page("/", null);
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    const cat = container.querySelector("[data-living-mascot]") !== null;
    unmount();
    vi.restoreAllMocks();

    expect(cat).toBe(false);
  });

  it("offers the language menu, and remembers only the language chosen there", async () => {
    const { container, unmount } = page("/", null);
    await settle();
    const before = localStorage.getItem("mca.locale");
    const trigger = container.querySelector<HTMLButtonElement>(
      'header button[aria-haspopup="menu"]',
    );
    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
    });
    const english = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (entry) => entry.querySelector("[lang]")?.getAttribute("lang") === "en",
    );
    act(() => english?.click());
    await settle();
    const seen = {
      before,
      after: localStorage.getItem("mca.locale"),
      page: document.documentElement.lang,
      heading: container.querySelector("main h2")?.textContent,
    };
    unmount();
    await act(() => i18n.changeLanguage("it"));
    localStorage.clear();

    expect(seen).toEqual({
      before: null,
      after: "en",
      page: "en",
      heading: i18n.t("entry.caption", { lng: "en" }),
    });
  });

  it.each([`/chat/${ID_7}`, "/staff", "/staff/programmes"])(
    "sends %s to the login page, which brings the reader back to it",
    async (path) => {
      const { unmount, path: where, state } = page(path, null);
      await settle();
      const landed = { path: where(), state: state() };
      unmount();

      expect(landed).toEqual({ path: "/login", state: { from: path } });
    },
  );

  // No deployment holds a `/c/` link, so none is redirected: it is an address
  // like any other that names no page, for a reader and a visitor alike.
  it.each([
    ["a reader", STUDENT],
    ["a visitor", null],
  ])(
    "shows %s an old /c/ address as a page that is not there, asking the server nothing",
    async (_, account) => {
      const { container, unmount, path } = page("/c/7", account);
      await settle();
      const seen = {
        heading: container.querySelector("h1")?.textContent,
        // The same panel as the error screens (RouteError.test.tsx), with the way back.
        back: container.querySelector('[data-status-panel] a[href="/"]')?.textContent,
        path: path(),
        read: requested.filter((request) => request.startsWith("GET /api/conversations/")),
      };
      unmount();

      expect(seen).toEqual({
        heading: i18n.t("notFound.title"),
        back: i18n.t("notFound.home"),
        path: "/c/7",
        read: [],
      });
    },
  );
});

/** Lets a test change who is signed in under a mounted page, as `recheck` does. */
let switchAccount: (next: Account | null) => void = () => {};

/** Built once, as the provider keeps `forget` stable: a new one each render would refetch by itself. */
const ACTIONS = {
  logIn: async () => {},
  register: async () => {},
  logOut: async () => {},
  chooseLocale: async () => {},
  chooseStudies: async () => {},
  forget: () => {},
  recheck: async () => {},
};

function SwitchingSession({
  children,
  initial = STUDENT,
}: {
  children: ReactNode;
  initial?: Account | null;
}) {
  const [account, setAccount] = useState<Account | null>(initial);
  switchAccount = setAccount;
  return <SessionContext value={{ account, ...ACTIONS }}>{children}</SessionContext>;
}

describe("another account signed in under the page", () => {
  beforeEach(() => {
    conversations = [OTHER];
    requested = [];
    vi.stubGlobal("fetch", fakeApi);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rebuilds the frame, so nothing of the first account stays on screen", async () => {
    const { unmount } = mount(
      <ThemeProvider>
        <SwitchingSession>
          <RouterProvider router={createMemoryRouter(routes)} />
        </SwitchingSession>
      </ThemeProvider>,
    );
    await settle();
    const lists = () => requested.filter((request) => request === "GET /api/conversations");
    const first = lists().length;

    act(() => switchAccount({ ...STUDENT, id: 2, username: "other" }));
    await settle();
    const second = lists().length;
    unmount();

    // Once for each account: the second list is the second account's.
    expect([first, second]).toEqual([1, 2]);
  });

  it("takes a visitor's thread away when an account signs in, and does not bring it back", async () => {
    const { container, unmount } = mount(
      <ThemeProvider>
        <SwitchingSession initial={null}>
          <RouterProvider router={createMemoryRouter(routes)} />
        </SwitchingSession>
      </ThemeProvider>,
    );
    await settle();
    askFromTheFrontDoor(container);
    await settle();
    finishReceding(container);
    const question = "Quali sono le scadenze per l'iscrizione?";
    const asked = container.querySelector("main")?.textContent?.includes(question);

    act(() => switchAccount(STUDENT));
    await settle();
    const signedIn = container.querySelector("main")?.textContent?.includes(question);
    act(() => switchAccount(null));
    await settle();
    const signedOut = container.querySelector("main")?.textContent?.includes(question);
    unmount();

    // The layout the chat sits in is swapped, so the page holding the thread
    // is unmounted: nothing of a visitor's questions is filed under an account,
    // or left for whoever signs out on a shared computer.
    expect({ asked, signedIn, signedOut }).toEqual({
      asked: true,
      signedIn: false,
      signedOut: false,
    });
  });
});

/** The application as it runs, under the provider that asks the server who is signed in. */
function app(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const mounted = mount(
    <ThemeProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ThemeProvider>,
  );
  return { ...mounted, path: () => router.state.location.pathname };
}

/**
 * The tab comes back into view, and the provider asks the server who is signed
 * in (SessionProvider.tsx): how this tab learns of a sign-out, or a sign-in, in
 * another one.
 */
async function backToThisTab() {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settle();
}

const DRAFT = "E quando scade la seconda rata?";

describe("a session that ends under the page", () => {
  beforeEach(() => {
    conversations = [STORED_ROW];
    requested = [];
    readFails = false;
    askFails = false;
    signedIn = true;
    vi.stubGlobal("fetch", fakeApi);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    signedIn = true;
    sessionOf = null;
    localStorage.clear();
  });

  const field = (container: HTMLElement) =>
    container.querySelector<HTMLTextAreaElement>("#question");

  const typed = () => backToThisTab();
  const sent = async (container: HTMLElement) => {
    act(() => container.querySelector<HTMLButtonElement>("button[type='submit']")?.click());
    await settle();
  };
  const other: Account = { ...STUDENT, id: 2, username: "other" };

  // A screen can be shared: what one account typed is not shown to the next.
  it.each([
    ["typed, when another tab signs out", "the account that typed it", typed, STUDENT, DRAFT],
    ["sent, when the server refuses it", "the account that typed it", sent, STUDENT, DRAFT],
    ["typed, when another tab signs out", "no other account", typed, other, ""],
    ["sent, when the server refuses it", "no other account", sent, other, ""],
  ])(
    "keeps a question %s, through the login page, at the address it was typed at, for %s",
    async (_, _who, end, account, kept) => {
      const { container, unmount, path } = app(`/chat/${ID_7}`);
      await settle();
      typeInto(container, DRAFT);
      signedIn = false;
      await end(container);
      const lost = path();
      signedIn = true;
      sessionOf = account;
      await backToThisTab();
      const back = { path: path(), typed: field(container)?.value };
      unmount();

      expect({ lost, back }).toEqual({
        lost: "/login",
        back: { path: `/chat/${ID_7}`, typed: kept },
      });
    },
  );

  // Signing out ends the draft, even a sign-out the server refuses because the
  // session had ended: the reader asked for it, so the page signs out all the same.
  it.each([
    ["while the session lasts", true],
    ["after it ended", false],
  ])("forgets the question being typed when the reader signs out %s", async (_, lasting) => {
    const { container, unmount, path } = app("/");
    await settle();
    typeInto(container, DRAFT);
    signedIn = lasting;
    const row = [...container.querySelectorAll('aside button[aria-haspopup="menu"]')].find(
      (button) => button.textContent?.includes(STUDENT.username),
    );
    // Radix opens a menu on pointerdown, not on click (dropdown-menu.test.tsx).
    act(() => {
      row?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    const signOut = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === i18n.t("account.logOut"),
    );
    act(() => signOut?.click());
    await settle();
    const out = { signedIn, path: path(), typed: field(container)?.value };
    // The same account, back at the address the draft was typed at.
    signedIn = true;
    await backToThisTab();
    const back = field(container)?.value;
    unmount();

    expect({ out, back }).toEqual({ out: { signedIn: false, path: "/", typed: "" }, back: "" });
  });
});

describe("what a question searches", () => {
  const PPM: ScopeCourse = {
    code: "B028451",
    name: "Progettazione e Produzione Multimediale",
    locale: "it",
    year_of_study: 3,
    editions: [
      { id: 42, academic_year: "2025-2026", state: "current", default: true },
      { id: 41, academic_year: "2024-2025", state: "past", default: false },
    ],
  };
  const DECLARED: Account = { ...STUDENT, programme: "B047", year_of_study: 3 };

  beforeEach(() => {
    conversations = [STORED_ROW];
    asked = [];
    scope = [PPM];
    vi.stubGlobal("fetch", fakeApi);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    scope = [];
    storedAdded = [];
  });

  /** The button in the question box's foot that opens the course list. */
  const button = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>('form button[aria-haspopup="menu"]');

  it("counts the editions the conversation adds, and a new conversation adds none", async () => {
    storedAdded = [41];
    const { container, unmount } = page(`/chat/${ID_7}`, DECLARED);
    await settle();
    const opened = button(container)?.textContent;
    openNewConversation(container);
    await settle();
    const fresh = button(container)?.textContent;
    unmount();

    expect({ opened, fresh }).toEqual({
      opened: i18n.t("scope.added", { count: 1 }),
      fresh: i18n.t("scope.current"),
    });
  });

  it("sends an edition ticked in the list with the next question", async () => {
    const { container, unmount } = page("/", DECLARED);
    await settle();
    act(() => {
      button(container)?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
    });
    const boxes = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
    // The current edition is searched in any case; the past one is the reader's to add.
    const offered = boxes.map((box) => ({
      checked: box.getAttribute("aria-checked"),
      fixed: box.hasAttribute("data-disabled"),
    }));
    act(() => boxes[1]?.click());
    askFromTheFrontDoor(container);
    await settle();
    const label = button(container)?.textContent;
    unmount();

    expect(offered).toEqual([
      { checked: "true", fixed: true },
      { checked: "false", fixed: false },
    ]);
    expect(asked.map((body) => body.added_editions)).toEqual([[41]]);
    expect(label).toBe(i18n.t("scope.added", { count: 1 }));
  });

  it("points an account with no programme and no role to the account page", async () => {
    scope = [];
    const { container, unmount } = page("/", STUDENT);
    await settle();
    const hint = container.querySelector('form a[href="/account"]')?.textContent;
    const list = button(container);
    unmount();

    expect({ hint, list }).toEqual({ hint: i18n.t("scope.declare"), list: null });
  });
});
