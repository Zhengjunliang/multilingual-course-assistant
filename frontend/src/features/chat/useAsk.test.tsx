// @vitest-environment jsdom

/**
 * A visitor's thread: what each question carries back, and where the thread
 * lives between questions.
 *
 * The server stores nothing for a visitor, so the two halves that replace the
 * stored conversation are both here — `historyOf`, which is the server's
 * `recent_turns` done on this side, and the tab's `sessionStorage`. The hook is
 * mounted for real and the network faked at `fetch`, as the routing test does,
 * because the request body is the claim.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HISTORY_WINDOW_TURNS, MAX_HISTORY_ANSWER_CHARS } from "@/api/client";
import type { RouteDecision } from "@/api/contract";
import { mount } from "@/test/mount";
import { historyOf, type Turn, useAsk } from "./useAsk";
import { readVisitorThread, writeVisitorThread } from "./visitorThread";

const ROUTE: RouteDecision = {
  target: "unifi_web",
  query: "tasse",
  fresh: false,
  reason: "campus question",
};

function turn(question: string, change: Partial<Turn> = {}): Turn {
  return {
    key: `stored-${question}`,
    question,
    answer: `About ${question}`,
    citations: [],
    route: ROUTE,
    locale: "it",
    complete: true,
    failure: null,
    ...change,
  };
}

/** The bodies `POST /api/ask` was sent, parsed. */
let sent: Record<string, unknown>[] = [];

async function fakeAsk(_: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  sent.push(body);
  const start = {
    question: body.question,
    conversation_id: "history" in body ? null : 9,
    locale: "it",
    route: ROUTE,
    citations: [],
  };
  const stream = `event: start\ndata: ${JSON.stringify(start)}\n\nevent: token\ndata: {"text": "Entro il 30 novembre."}\n\nevent: end\ndata: {}\n\n`;
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** The hook as a page holds it, handed out after every render. */
let hook: ReturnType<typeof useAsk>;

function Probe({ visitor }: { visitor: boolean }) {
  hook = useAsk(visitor);
  return null;
}

/** Lets every pending fetch, body read and state update land. */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("what a visitor's question carries back", () => {
  it("is the last turns that reached the server, answers cut to the cap", () => {
    const turns = [
      turn("one"),
      turn("two"),
      // Refused before `start`: the server never stored it either.
      turn("refused", { route: null, answer: "", complete: false }),
      turn("three"),
      turn("four", { answer: "x".repeat(MAX_HISTORY_ANSWER_CHARS + 1) }),
      // Cut off midway, and sent as the reader saw it.
      turn("five", { answer: "Entro il", complete: false, failure: { kind: "incomplete" } }),
    ];

    const history = historyOf(turns);

    expect(history).toHaveLength(HISTORY_WINDOW_TURNS);
    expect(history.map((exchange) => exchange.question)).toEqual(["three", "four", "five"]);
    expect(history[1]?.answer).toHaveLength(MAX_HISTORY_ANSWER_CHARS);
    expect(history[2]?.answer).toBe("Entro il");
  });
});

describe("a visitor's thread", () => {
  beforeEach(() => {
    sent = [];
    sessionStorage.clear();
    vi.stubGlobal("fetch", fakeAsk);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("travels with a visitor's question, and a signed-in one names its conversation instead", async () => {
    writeVisitorThread([turn("Quando scadono le tasse?")]);

    const visitor = mount(<Probe visitor />);
    await act(() => hook.submit("E se pago in ritardo?"));
    await settle();
    const kept = readVisitorThread();
    visitor.unmount();

    const member = mount(<Probe visitor={false} />);
    const shown = hook.turns.length;
    await act(() => hook.submit("Che cos'è un ORM?"));
    await settle();
    member.unmount();

    expect(sent).toEqual([
      {
        question: "E se pago in ritardo?",
        history: [
          { question: "Quando scadono le tasse?", answer: "About Quando scadono le tasse?" },
        ],
      },
      { question: "Che cos'è un ORM?", conversation_id: null },
    ]);
    // The new exchange joined the thread the tab keeps, whole.
    expect(kept.map((exchange) => [exchange.question, exchange.complete])).toEqual([
      ["Quando scadono le tasse?", true],
      ["E se pago in ritardo?", true],
    ]);
    // Somebody signed in never sees a visitor's thread.
    expect(shown).toBe(0);
  });

  it("survives a reload, an answer it cut off coming back interrupted", () => {
    writeVisitorThread([turn("one"), turn("two", { answer: "Entro", complete: false })]);

    const page = mount(<Probe visitor />);
    const turns = hook.turns;
    page.unmount();

    expect(turns.map((exchange) => exchange.failure)).toEqual([null, { kind: "incomplete" }]);
  });

  it("is emptied by a new conversation", () => {
    writeVisitorThread([turn("one")]);

    const page = mount(<Probe visitor />);
    act(() => hook.reset());
    page.unmount();

    expect(readVisitorThread()).toEqual([]);
  });

  it("is empty, and the page still works, where storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const page = mount(<Probe visitor />);
    const before = hook.turns.length;
    await act(() => hook.submit("Quando scadono le tasse?"));
    await settle();
    const answered = hook.turns.map((exchange) => exchange.complete);
    page.unmount();

    expect(before).toBe(0);
    expect(answered).toEqual([true]);
  });
});
