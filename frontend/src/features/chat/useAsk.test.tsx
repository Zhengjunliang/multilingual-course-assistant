// @vitest-environment jsdom

/**
 * A visitor's thread: what each question carries back, and how long the
 * thread lasts; and a question that does not get its whole answer.
 *
 * The server stores nothing for a visitor, so `historyOf` — the server's
 * `recent_turns` done on this side — is what makes a follow-up a follow-up,
 * and the thread itself lasts as long as the page. The hook is mounted for
 * real and the network faked at `fetch`, as the routing test does, because
 * the request body is the claim. A failure is kept as the coded error it
 * arrived as (#186).
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HISTORY_WINDOW_TURNS, MAX_HISTORY_ANSWER_CHARS } from "@/api/client";
import type { RouteDecision } from "@/api/contract";
import type { ErrorCode, ErrorData } from "@/api/errors";
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
      turn("five", { answer: "Entro il", complete: false, failure: { kind: "interrupted" } }),
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

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const START_FRAME = `event: start\ndata: ${JSON.stringify({
  question: "Quando scadono le tasse?",
  conversation_id: null,
  locale: "it",
  route: ROUTE,
  citations: [],
  search_ms: 40,
})}\n\n`;
const TOKEN_FRAME = 'event: token\ndata: {"text": "Entro il"}\n\n';

/** The coded body, `{"error": ...}`, as one `error` frame. */
function codedFrame(code: ErrorCode, data: ErrorData = {}): string {
  const error = { code, message: "…", data, fields: [], request_id: ID };
  return `event: error\ndata: ${JSON.stringify({ error })}\n\n`;
}

/** `fetch` answering every question with `status` and `body`, framed and with its request id. */
function answering(status: number, body: string) {
  const calls = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "Content-Type": "text/event-stream", "X-Request-ID": ID },
      }),
  );
  vi.stubGlobal("fetch", calls);
  return calls;
}

describe("a question that does not get its whole answer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Lets the pending requests, body reads and state updates land, `ms` later. */
  async function wait(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
  }

  /** Asks one question as a visitor and hands back where the hook stopped. */
  async function ask() {
    const { unmount } = mount(<Probe visitor />);
    await act(async () => {
      void hook.submit("Quando scadono le tasse?");
    });
    await wait(0);
    const { waiting, turns } = hook;
    unmount();
    return { waiting, turn: turns[0] };
  }

  it("waits out a busy engine for the seconds its refusal names, twice, and then stops", async () => {
    const calls = answering(503, codedFrame("UNAVAILABLE", { retry_after_seconds: 7 }));
    const { unmount } = mount(<Probe visitor />);

    await act(async () => {
      void hook.submit("Quando scadono le tasse?");
    });
    await wait(0);
    const first = hook.waiting;
    await wait(7000);
    const second = hook.waiting;
    await wait(7000);
    const last = hook.waiting;
    unmount();

    expect({ first, second, asked: calls.mock.calls.length }).toEqual({
      first: { phase: "retrying", seconds: 7, attempt: 1 },
      second: { phase: "retrying", seconds: 7, attempt: 2 },
      asked: 3,
    });
    expect(last).toMatchObject({
      phase: "stopped",
      failure: { kind: "failed", error: { code: "UNAVAILABLE", requestId: ID } },
    });
  });

  it("does not ask an engine that is down again", async () => {
    const calls = answering(503, codedFrame("ENGINE_DOWN"));

    const { waiting } = await ask();

    expect(calls).toHaveBeenCalledTimes(1);
    expect(waiting).toMatchObject({
      phase: "stopped",
      failure: { kind: "failed", error: { status: 503, code: "ENGINE_DOWN", requestId: ID } },
    });
  });

  it("reads a request that never reached the server as the network's failure", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const { waiting } = await ask();

    expect(waiting).toMatchObject({
      phase: "stopped",
      failure: { kind: "failed", error: { status: 0, code: "NETWORK", requestId: null } },
    });
  });

  it.each([
    ["the coded event", codedFrame("ENGINE_DOWN"), "ENGINE_DOWN"],
    ["an event it cannot read", 'event: error\ndata: {"detail": "…"}\n\n', "BAD_RESPONSE"],
  ])(
    "keeps the part an error inside the stream cut short, and the error from %s",
    async (_, frame, code) => {
      answering(200, START_FRAME + TOKEN_FRAME + frame);

      const { waiting, turn } = await ask();

      expect(turn?.answer).toBe("Entro il");
      expect(waiting).toMatchObject({
        phase: "stopped",
        failure: { kind: "failed", error: { status: 200, requestId: ID, code } },
      });
    },
  );

  it("reads a stream that stops before its end as interrupted, under the response's request id", async () => {
    answering(200, START_FRAME + TOKEN_FRAME);

    const { waiting, turn } = await ask();

    expect(turn?.answer).toBe("Entro il");
    expect(waiting).toMatchObject({
      phase: "stopped",
      failure: { kind: "failed", error: { code: "STREAM_INTERRUPTED", requestId: ID } },
    });
  });
});
