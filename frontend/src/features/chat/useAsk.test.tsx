// @vitest-environment jsdom

/**
 * A visitor's thread: what each question carries back, and how long the
 * thread lasts; a question that does not get its whole answer; and an answer
 * a worker writes, which waits in a queue, can be stopped, and is read back
 * from its stream after a dropped connection or a reload.
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
import type { ConversationDetail, StoredMessage } from "@/api/conversations";
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
    conversation_id: "history" in body ? null : "00000000-0000-4000-8000-000000000009",
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

const ANSWER = "9b2e0c4d-6f1a-4e3b-8c5d-7a9e1f2b3c4d";
const CONVERSATION = "00000000-0000-4000-8000-000000000009";
const EVENTS_URL = `/api/answers/${ANSWER}/events`;
const EVENTS = `GET ${EVENTS_URL}`;

/** One frame as the server writes it, under its stream entry's id. */
function frame(name: string, data: object, id: string): string {
  return `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const QUEUED = frame(
  "queued",
  { answer_id: ANSWER, conversation_id: CONVERSATION, question: "Che cos'è un ORM?" },
  "1-0",
);
const STARTED = frame(
  "start",
  {
    question: "Che cos'è un ORM?",
    conversation_id: CONVERSATION,
    locale: "it",
    route: ROUTE,
    citations: [],
    search_ms: 40,
  },
  "2-0",
);
const FIRST = frame("token", { text: "Un ORM " }, "3-0");
const REST = frame("token", { text: "mappa le tabelle." }, "4-0");
const ENDED = frame("end", {}, "5-0");

/** A body that stays open for the test to write into, end, or break off. */
function pipe() {
  const encoder = new TextEncoder();
  let writer: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  return {
    body,
    write: (frames: string) => writer?.enqueue(encoder.encode(frames)),
    end: () => writer?.close(),
    fail: (error: Error) => writer?.error(error),
  };
}

type Pipe = ReturnType<typeof pipe>;

/** The requests the page made, in order. */
let calls: { method: string; url: string; lastEventId: string | null }[] = [];

/**
 * `fetch` answering each request with the next body queued for its method and
 * path. A string is the whole stream; a pipe stays open, and breaks off when
 * its request is aborted, as a real response's body does.
 */
function serve(routes: Record<string, (string | Pipe)[]>) {
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = String(input);
    calls.push({ method, url, lastEventId: new Headers(init.headers).get("Last-Event-ID") });
    if (url.endsWith("/stop")) return new Response(null, { status: 204 });
    const body = routes[`${method} ${url}`]?.shift();
    if (body === undefined) throw new Error(`no body for ${method} ${url}`);
    if (typeof body !== "string") {
      init.signal?.addEventListener("abort", () =>
        body.fail(new DOMException("The operation was aborted.", "AbortError")),
      );
    }
    return new Response(typeof body === "string" ? body : body.body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "X-Request-ID": ID },
    });
  });
}

function row(
  id: string,
  role: StoredMessage["role"],
  text: string,
  complete = true,
): StoredMessage {
  const answer = role === "assistant";
  return {
    id,
    role,
    text,
    locale: "it",
    complete,
    citations: [],
    route: answer ? ROUTE : null,
    search_ms: answer ? 40 : null,
    created_at: "2026-10-29T10:00:00Z",
  };
}

function detail(messages: StoredMessage[], answering: string | null): ConversationDetail {
  return {
    id: CONVERSATION,
    locale: "it",
    created_at: "2026-10-29T10:00:00Z",
    last_message_at: "2026-10-29T10:01:00Z",
    title: "Quando scadono le tasse?",
    title_locale: "it",
    pinned: false,
    last_source: null,
    messages,
    answering,
    added_editions: [],
  };
}

const EARLIER = [
  row("q-1", "user", "Quando scadono le tasse?"),
  row("a-1", "assistant", "Entro il 30 novembre."),
];

describe("a question answered on a worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Asks one question, its answer arriving on whatever `serve` was given. */
  async function ask(visitor: boolean) {
    const page = mount(<Probe visitor={visitor} />);
    await act(async () => {
      void hook.submit("Che cos'è un ORM?");
    });
    return page;
  }

  it("waits in the queue until `start`, and names its conversation only then", async () => {
    const answer = pipe();
    serve({ "POST /api/ask": [answer] });
    const { unmount } = await ask(false);

    answer.write(QUEUED);
    await settle();
    const queued = { waiting: hook.waiting, conversation: hook.conversationId };
    answer.write(STARTED + FIRST);
    await settle();
    const started = { waiting: hook.waiting, conversation: hook.conversationId };
    answer.write(ENDED);
    answer.end();
    await settle();
    const ended = hook.waiting;
    unmount();

    expect({ queued, started, ended }).toEqual({
      queued: { waiting: { phase: "queued" }, conversation: null },
      started: { waiting: { phase: "streaming" }, conversation: CONVERSATION },
      ended: { phase: "idle" },
    });
  });

  it("shows an answer stopped elsewhere as interrupted, and keeps what was written", async () => {
    serve({ "POST /api/ask": [QUEUED + STARTED + FIRST + frame("stopped", {}, "4-0")] });
    const { unmount } = await ask(false);
    await settle();
    const { waiting, turns } = hook;
    unmount();

    expect(turns[0]).toMatchObject({ answer: "Un ORM ", failure: { kind: "interrupted" } });
    expect(waiting).toEqual({ phase: "stopped", failure: { kind: "interrupted" } });
  });

  it.each([
    ["a visitor's", true],
    ["a student's", false],
  ])("tells the server to stop %s answer, and stops reading it", async (_, visitor) => {
    const answer = pipe();
    serve({ "POST /api/ask": [answer] });
    const { unmount } = await ask(visitor);
    answer.write(QUEUED + STARTED + FIRST);
    await settle();

    act(() => hook.stop());
    await settle();
    const { waiting, turns } = hook;
    unmount();

    expect(calls.at(-1)).toEqual({
      method: "POST",
      url: `/api/answers/${ANSWER}/stop`,
      lastEventId: null,
    });
    expect({ waiting, answer: turns[0]?.answer }).toEqual({
      waiting: { phase: "idle" },
      answer: "Un ORM ",
    });
  });

  it("opens a student's dropped stream again, after the last event read", async () => {
    const answer = pipe();
    serve({ "POST /api/ask": [answer], [EVENTS]: [REST + ENDED] });
    const { unmount } = await ask(false);
    answer.write(QUEUED + STARTED + FIRST);
    await settle();

    answer.fail(new TypeError("network error"));
    await settle();
    const { waiting, turns } = hook;
    unmount();

    expect(calls.at(-1)).toEqual({ method: "GET", url: EVENTS_URL, lastEventId: "3-0" });
    expect(turns[0]).toMatchObject({
      answer: "Un ORM mappa le tabelle.",
      complete: true,
      failure: null,
    });
    expect(waiting).toEqual({ phase: "idle" });
  });

  it.each([
    ["a visitor's, which is not opened again", true, 1, "Un ORM "],
    ["a student's, dropped a second time", false, 2, "Un ORM mappa le tabelle."],
  ])("reads a stream that breaks off as interrupted: %s", async (_, visitor, requests, text) => {
    serve({ "POST /api/ask": [QUEUED + STARTED + FIRST], [EVENTS]: [REST] });
    const { unmount } = await ask(visitor);
    await settle();
    const { waiting, turns } = hook;
    unmount();

    expect(calls).toHaveLength(requests);
    expect(turns[0]?.answer).toBe(text);
    expect(waiting).toMatchObject({
      phase: "stopped",
      failure: {
        kind: "failed",
        error: { status: 200, code: "STREAM_INTERRUPTED", requestId: ID },
      },
    });
  });

  it.each([
    [
      "once its rows are written",
      [row("q-2", "user", "Che cos'è un ORM?"), row(ANSWER, "assistant", "Un ORM ", false)],
    ],
    ["while it waits for a worker", []],
  ])("reads an answer being written back from its stream, %s", async (_, writing) => {
    serve({ [EVENTS]: [QUEUED + STARTED + FIRST + REST + ENDED] });
    const { unmount } = mount(<Probe visitor={false} />);

    await act(() => hook.adopt(detail([...EARLIER, ...writing], ANSWER)));
    const { waiting, turns } = hook;
    unmount();

    expect(calls).toEqual([{ method: "GET", url: EVENTS_URL, lastEventId: null }]);
    expect(turns.map(({ question, answer, complete }) => ({ question, answer, complete }))).toEqual(
      [
        { question: "Quando scadono le tasse?", answer: "Entro il 30 novembre.", complete: true },
        { question: "Che cos'è un ORM?", answer: "Un ORM mappa le tabelle.", complete: true },
      ],
    );
    expect(waiting).toEqual({ phase: "idle" });
  });

  it("reads a conversation nobody is answering from its rows alone", async () => {
    serve({});
    const { unmount } = mount(<Probe visitor={false} />);

    await act(() => hook.adopt(detail(EARLIER, null)));
    const { waiting, turns } = hook;
    unmount();

    expect({ requests: calls.length, turns: turns.length, waiting }).toEqual({
      requests: 0,
      turns: 1,
      waiting: { phase: "idle" },
    });
  });
});

describe("the editions a conversation adds", () => {
  beforeEach(() => {
    sent = [];
    vi.stubGlobal("fetch", fakeAsk);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** What each question asked carried, `undefined` for none. */
  const carried = () => sent.map((body) => body.added_editions);

  it("go with the next question once chosen, and with no later one", async () => {
    const { unmount } = mount(<Probe visitor={false} />);
    await act(() => hook.submit("Che cos'è un ORM?"));
    await settle();
    act(() => hook.choose([7, 9]));
    await act(() => hook.submit("E una migrazione?"));
    await settle();
    await act(() => hook.submit("E un indice?"));
    await settle();
    unmount();

    expect(carried()).toEqual([undefined, [7, 9], undefined]);
  });

  it("go again with the next question when the last was refused before `start`", async () => {
    // The server stores them with the question's rows, which a refusal never writes.
    let refuse = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!refuse) return fakeAsk(input, init);
      refuse = false;
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(codedFrame("ENGINE_DOWN"), {
        status: 503,
        headers: { "Content-Type": "text/event-stream", "X-Request-ID": ID },
      });
    });
    const { unmount } = mount(<Probe visitor={false} />);
    act(() => hook.choose([7]));
    await act(() => hook.submit("Che cos'è un ORM?"));
    await settle();
    await act(() => hook.submit("Che cos'è un ORM?"));
    await settle();
    unmount();

    expect(carried()).toEqual([[7], [7]]);
  });

  it("come back with their conversation, and a new conversation has none", async () => {
    const { unmount } = mount(<Probe visitor={false} />);
    await act(() => hook.adopt({ ...detail(EARLIER, null), added_editions: [7] }));
    const opened = hook.added;
    await act(() => hook.submit("E se pago in ritardo?"));
    await settle();
    act(() => hook.reset());
    const fresh = hook.added;
    unmount();

    expect({ opened, fresh, carried: carried() }).toEqual({
      opened: [7],
      fresh: [],
      carried: [undefined],
    });
  });
});
