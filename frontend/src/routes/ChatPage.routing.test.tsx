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
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { summary } from "@/test/conversations";
import { type Mounted, mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

const STORED_ROW = summary({
  id: 7,
  created_at: "2026-09-28T10:00:00Z",
  title: "Che cos'è un ORM?",
});

const STORED: ConversationDetail = {
  ...STORED_ROW,
  messages: [
    {
      id: 1,
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
      id: 2,
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
};

/** What `GET /api/conversations` answers; a question on `/` adds to it, as the server does. */
let conversations: ConversationSummary[] = [];
/** Whether `DELETE` fails, as a server error would. */
let deleteFails = false;
/** Whether `GET /api/conversations` fails, as a dropped connection would. */
let listFails = false;
/** How many `PATCH`es fail before one goes through, as a server error would. */
let pinFailures = 0;
/** Every request made, as `METHOD path`. */
let requested: string[] = [];
/** How many times the page asked the session provider who is signed in. */
let rechecked = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** An answer stream in the framing `api/sse.ts` reads: `start`, then `end`. */
function answerStream(conversationId: number | null, question: string): Response {
  const start = {
    question,
    conversation_id: conversationId,
    locale: "it",
    route: { target: "unifi_web", query: question, fresh: false, reason: "campus question" },
    citations: [],
    search_ms: 1200,
  };
  const body = `event: start\ndata: ${JSON.stringify(start)}\n\nevent: end\ndata: {}\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  requested.push(`${method} ${path}`);
  if (method === "GET" && path === "/api/conversations") {
    return listFails ? json({ detail: "Server error." }, 500) : json(conversations);
  }
  if (method === "GET" && path === "/api/conversations/7") return json(STORED);
  if (method === "DELETE" && path.startsWith("/api/conversations/")) {
    if (deleteFails) return json({ detail: "Server error." }, 500);
    const id = Number(path.slice("/api/conversations/".length));
    if (!conversations.some((row) => row.id === id)) return json({ detail: "Not found." }, 404);
    conversations = conversations.filter((row) => row.id !== id);
    return new Response(null, { status: 204 });
  }
  if (method === "PATCH" && path.startsWith("/api/conversations/")) {
    if (pinFailures > 0) {
      pinFailures -= 1;
      return json({ detail: "Server error." }, 500);
    }
    const id = Number(path.slice("/api/conversations/".length));
    const row = conversations.find((listed) => listed.id === id);
    if (row === undefined) return json({ detail: "Not found." }, 404);
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
  if (method === "POST" && path === "/api/ask") {
    const { question, history } = JSON.parse(String(init.body)) as {
      question: string;
      history?: unknown;
    };
    // A visitor's question is filed nowhere, as the server has it.
    if (history !== undefined) return answerStream(null, question);
    conversations = [
      summary({ id: 9, created_at: "2026-09-29T09:00:00Z", title: question }),
      ...conversations,
    ];
    return answerStream(9, question);
  }
  return json({ detail: "Not found." }, 404);
}

const STUDENT: Account = {
  id: 1,
  username: "junliang",
  locale: "it",
  is_superuser: false,
  roles: [],
};

interface Page extends Mounted {
  /** Where the router is, as the address bar shows it. */
  path: () => string;
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
  return { ...mounted, path: () => router.state.location.pathname };
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

/** Types a question into the composer under the entry and presses send. */
function askFromTheFrontDoor(container: HTMLElement) {
  const field = container.querySelector<HTMLTextAreaElement>("#question");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, "Quali sono le scadenze per l'iscrizione?");
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  id: 8,
  created_at: "2026-09-27T10:00:00Z",
  title: "Quando scadono le tasse?",
});

describe("the chat page's address", () => {
  beforeEach(() => {
    conversations = [STORED_ROW, OTHER];
    deleteFails = false;
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
    deletedElsewhere?: number;
    /** A sidebar row that must be gone afterwards. */
    gone?: string;
    /** A sidebar row that must still be there afterwards. */
    kept?: string;
    /** A request the step must not cause. */
    unrequested?: string;
  }

  it.each<Case>([
    { name: "opening a new conversation", from: "/c/7", step: openNewConversation, lands: "/" },
    {
      name: "leaving a conversation before it loaded",
      from: "/c/7",
      step: openNewConversation,
      lands: "/",
      early: true,
    },
    {
      name: "asking on / moves to /c/9",
      from: "/",
      step: askFromTheFrontDoor,
      lands: "/c/9",
      // A page rebuilt by the move would read the conversation it is still
      // writing, and drop the answer on screen for what the server has so far.
      unrequested: "GET /api/conversations/9",
    },
    {
      name: "deleting the open conversation",
      from: "/c/7",
      step: deleting(STORED.title),
      lands: "/",
      gone: "/c/7",
    },
    {
      name: "deleting another conversation",
      from: "/c/7",
      step: deleting(OTHER.title),
      lands: "/c/7",
      gone: "/c/8",
    },
    {
      name: "a delete the server refuses",
      from: "/c/7",
      step: deleting(STORED.title),
      lands: "/c/7",
      failing: true,
      kept: "/c/7",
    },
    {
      name: "deleting a conversation another tab deleted",
      from: "/c/7",
      step: deleting(STORED.title),
      lands: "/",
      deletedElsewhere: 7,
      gone: "/c/7",
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
      "PATCH /api/conversations/8",
      "PATCH /api/conversations/8",
    ]);
    expect(pinned).toEqual(["/c/8"]);
    expect(focusedOnUnpin).toBe(i18n.t("sidebar.unpin", { title }));
    expect(recent).toEqual(["/c/7", "/c/8"]);
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
    expect(pinned).toEqual(["/c/8"]);
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
    expect(pinned).toEqual(["/c/8"]);
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

    expect(rows).toEqual(["/c/7"]);
    expect(focused).toBe(i18n.t("sidebar.new"));
  });
});

describe("a visitor's addresses", () => {
  beforeEach(() => {
    conversations = [];
    requested = [];
    rechecked = 0;
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

  it.each(["/c/7", "/staff", "/staff/programmes"])("sends %s to the login page", async (path) => {
    const { unmount, path: where } = page(path, null);
    await settle();
    const landed = where();
    unmount();

    expect(landed).toBe("/login");
  });
});

/** Lets a test change who is signed in under a mounted page, as `recheck` does. */
let switchAccount: (next: Account | null) => void = () => {};

/** Built once, as the provider keeps `forget` stable: a new one each render would refetch by itself. */
const ACTIONS = {
  logIn: async () => {},
  register: async () => {},
  logOut: async () => {},
  chooseLocale: async () => {},
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
