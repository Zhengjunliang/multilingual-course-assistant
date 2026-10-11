// @vitest-environment jsdom

/**
 * A visitor's thread: what each question carries back, and how long the
 * thread lasts.
 *
 * The server stores nothing for a visitor, so `historyOf` — the server's
 * `recent_turns` done on this side — is what makes a follow-up a follow-up,
 * and the thread itself lasts as long as the page. The hook is mounted for
 * real and the network faked at `fetch`, as the routing test does, because
 * the request body is the claim.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HISTORY_WINDOW_TURNS, MAX_HISTORY_ANSWER_CHARS } from "@/api/client";
import type { RouteDecision } from "@/api/contract";
import { mount } from "@/test/mount";
import { historyOf, type Turn, useAsk } from "./useAsk";

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
    searchMs: 1200,
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

  it("cuts an answer between characters, never inside one", () => {
    // Cut by UTF-16 unit, a character outside the BMP at the cap would leave
    // half of itself behind, which the server refuses: every later question of
    // the thread would then be a 400. The server counts code points too.
    const emoji = String.fromCodePoint(0x1f600);
    const answer = `${"x".repeat(MAX_HISTORY_ANSWER_CHARS - 1)}${emoji}tail`;

    const [exchange] = historyOf([turn("long", { answer })]);

    expect(exchange?.answer).toBe(`${"x".repeat(MAX_HISTORY_ANSWER_CHARS - 1)}${emoji}`);
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
  });

  it("travels with a visitor's question, and a signed-in one names its conversation instead", async () => {
    const visitor = mount(<Probe visitor />);
    await act(() => hook.submit("Quando scadono le tasse?"));
    await settle();
    await act(() => hook.submit("E se pago in ritardo?"));
    await settle();
    visitor.unmount();

    const member = mount(<Probe visitor={false} />);
    await act(() => hook.submit("Che cos'è un ORM?"));
    await settle();
    member.unmount();

    expect(sent).toEqual([
      { question: "Quando scadono le tasse?", history: [] },
      {
        question: "E se pago in ritardo?",
        history: [{ question: "Quando scadono le tasse?", answer: "Entro il 30 novembre." }],
      },
      { question: "Che cos'è un ORM?", conversation_id: null },
    ]);
  });

  it("starts again on a reload, and leaves nothing in the browser behind it", async () => {
    const before = mount(<Probe visitor />);
    await act(() => hook.submit("Quando scadono le tasse?"));
    await settle();
    const asked = hook.turns.length;
    before.unmount();

    const after = mount(<Probe visitor />);
    const reloaded = hook.turns.length;
    after.unmount();

    expect({ asked, reloaded, stored: sessionStorage.length + localStorage.length }).toEqual({
      asked: 1,
      reloaded: 0,
      stored: 0,
    });
  });
});
