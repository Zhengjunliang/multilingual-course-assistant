// @vitest-environment jsdom

/**
 * Where the chat page leaves the reader, asked of the whole application.
 *
 * The URL is the page's state (ChatPage.tsx says why), and the bugs worth
 * catching live between two effects that both read it in the same commit — no
 * test of one component in isolation sees them. So this mounts `App` behind a
 * memory router and fakes the network at `fetch`, the HTTP boundary, with a
 * small in-memory server. The assertions are about what a reader sees: the
 * path, and which conversations the sidebar lists.
 */

import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import type { ConversationDetail, ConversationSummary } from "@/api/conversations";
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { type Mounted, mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

const STORED: ConversationDetail = {
  id: 7,
  locale: "it",
  created_at: "2026-09-28T10:00:00Z",
  title: "Che cos'è un ORM?",
  messages: [
    {
      id: 1,
      role: "user",
      text: "Che cos'è un ORM?",
      locale: "it",
      complete: true,
      citations: [],
      route: null,
    },
    {
      id: 2,
      role: "assistant",
      text: "Un ORM mappa le tabelle in classi.",
      locale: "it",
      complete: true,
      citations: [],
      route: null,
    },
  ],
};

/** What `GET /api/conversations` answers; a question on `/` adds to it, as the server does. */
let conversations: ConversationSummary[] = [];
/** Whether `DELETE` fails, as a server error would. */
let deleteFails = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** An answer stream in the framing `api/sse.ts` reads: `start`, then `end`. */
function answerStream(conversationId: number, question: string): Response {
  const start = {
    question,
    conversation_id: conversationId,
    locale: "it",
    route: { target: "unifi_web", query: question, fresh: false, reason: "campus question" },
    citations: [],
  };
  const body = `event: start\ndata: ${JSON.stringify(start)}\n\nevent: end\ndata: {}\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  if (method === "GET" && path === "/api/conversations") return json(conversations);
  if (method === "GET" && path === "/api/conversations/7") return json(STORED);
  if (method === "DELETE" && path.startsWith("/api/conversations/")) {
    if (deleteFails) return json({ detail: "Server error." }, 500);
    const id = Number(path.slice("/api/conversations/".length));
    if (!conversations.some((row) => row.id === id)) return json({ detail: "Not found." }, 404);
    conversations = conversations.filter((row) => row.id !== id);
    return new Response(null, { status: 204 });
  }
  if (method === "POST" && path === "/api/ask") {
    const { question } = JSON.parse(String(init.body)) as { question: string };
    conversations = [
      { id: 9, locale: "it", created_at: "2026-09-29T09:00:00Z", title: question },
      ...conversations,
    ];
    return answerStream(9, question);
  }
  return json({ detail: "Not found." }, 404);
}

function Pathname() {
  return <output>{useLocation().pathname}</output>;
}

function page(path: string): Mounted {
  return mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: { id: 1, username: "junliang", locale: "it" },
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

/** Lets every pending fetch, body read and state update land. */
async function settle() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function pathname(container: HTMLElement) {
  return container.querySelector("output")?.textContent;
}

function openNewConversation(container: HTMLElement) {
  act(() => container.querySelector<HTMLAnchorElement>('a[href="/"]')?.click());
}

/** A suggestion chip asks its question at once, which is the shortest way to ask. */
function askFromTheFrontDoor(container: HTMLElement) {
  act(() => container.querySelector<HTMLButtonElement>("main button")?.click());
}

/** Deletes a conversation from its sidebar row, through the confirmation dialog. */
function deleting(title: string) {
  return (container: HTMLElement) => {
    const label = i18n.t("sidebar.delete", { title });
    const row = [...container.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (button) => button.getAttribute("aria-label") === label,
    );
    act(() => row?.click());
    // The dialog is portalled to the body, outside the container.
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === i18n.t("sidebar.deleteConfirm"));
    act(() => confirm?.click());
  };
}

const OTHER: ConversationSummary = {
  id: 8,
  locale: "it",
  created_at: "2026-09-27T10:00:00Z",
  title: "Quando scadono le tasse?",
};

describe("the chat page's address", () => {
  beforeEach(() => {
    conversations = [
      { id: STORED.id, locale: STORED.locale, created_at: STORED.created_at, title: STORED.title },
      OTHER,
    ];
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
    { name: "asking on / moves to /c/9", from: "/", step: askFromTheFrontDoor, lands: "/c/9" },
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
    const { from, step, lands, early, failing, deletedElsewhere, gone } = scenario;
    deleteFails = failing === true;
    const { container, unmount } = page(from);
    if (!early) await settle();
    if (deletedElsewhere !== undefined) {
      conversations = conversations.filter((listed) => listed.id !== deletedElsewhere);
    }

    step(container);
    await settle();
    const landed = pathname(container);
    // A second round: a bounce is an effect reacting to the first landing.
    await settle();
    const stayed = pathname(container);
    const row = (href: string) => container.querySelector(`aside a[href="${href}"]`);
    const goneRow = gone === undefined ? null : row(gone);
    const keptRow = row(from);
    const saidFailed = document.body.textContent?.includes(i18n.t("sidebar.deleteFailed"));
    unmount();

    expect(landed).toBe(lands);
    expect(stayed).toBe(lands);
    // The deleted row is off the refreshed sidebar, which is also what proves
    // the step found its button: a missed click would leave it there.
    expect(goneRow).toBeNull();
    if (failing) {
      // The dialog says so, which a missed click would not, and nothing moved.
      expect(saidFailed).toBe(true);
      expect(keptRow).not.toBeNull();
    }
  });
});
