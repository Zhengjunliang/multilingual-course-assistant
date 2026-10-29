/**
 * One question's life, from submitted to settled.
 *
 * The states are not decoration. `queued` exists because the wait a reader
 * actually feels starts when the POST leaves, not when the first word comes:
 * the server admits the question at once, and it then waits for a worker
 * (docs/background-tasks.md) until `start`. Showing nothing during that
 * silence is the dishonest part.
 *
 * An `UNAVAILABLE` 503, the server's cap on questions in flight reached, is
 * retried at most twice and then stopped, because an automatic retry that
 * never gives up is a page that looks like it is working while nothing is.
 * `ENGINE_DOWN` is not retried at all — a model server or a Qdrant service that
 * is not running does not start because we asked again.
 *
 * Leaving closes the connection. A visitor's answer stops with it; a signed-in
 * student's goes on, on the worker, and opening its conversation again reads
 * it back from its stream (`adopt`). The stop button tells the server first,
 * since for a student the connection closing stops nothing.
 *
 * A visitor without an account asks the same way and keeps the thread: the
 * server stores nothing for them (docs/decisions.md, 2026-09-25, *The data
 * model is decided on paper*, point 3), so each question carries the recent
 * exchanges back (`historyOf`). The thread lives in this hook's state and
 * nowhere else: a reload or a closed tab starts again, as ChatGPT and Gemini do
 * for a reader who is not signed in (outside the repository, read 11 October
 * 2026), and on a shared lab computer nothing of it is left for the next
 * student. Signing in, up or out swaps the layout the chat sits in
 * (auth/RequireSession.tsx), which unmounts this page and the thread with it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Answering,
  ask,
  HISTORY_WINDOW_TURNS,
  type HistoryTurn,
  MAX_HISTORY_ANSWER_CHARS,
  resumeAnswer,
  stopAnswer,
} from "@/api/client";
import type { Citation, RouteDecision } from "@/api/contract";
import type { ConversationDetail, StoredMessage } from "@/api/conversations";
import { ApiError } from "@/api/http";
import { follow } from "./follow";

export const MAX_BUSY_RETRIES = 2;

/** How far a turn got, when it did not get all the way. */
export type Failure =
  /** This question's request failed, and the error says how, by its code. */
  | { kind: "failed"; error: ApiError }
  /**
   * An answer stopped before its end: read back unfinished with its
   * conversation, the request it came from long gone, or stopped elsewhere
   * while this page read it.
   */
  | { kind: "interrupted" };

/** One exchange as the interface holds it, live or replayed from the database. */
export interface Turn {
  key: string;
  question: string;
  answer: string;
  citations: Citation[];
  route: RouteDecision | null;
  /**
   * How long the server searched, from `start` or the stored row; `null` until
   * then, and for good on an answer stored before the server kept it.
   */
  searchMs: number | null;
  /**
   * The language the answer was written in, from `start` or the stored row;
   * `null` until then. Not the interface's language: a Chinese answer in the
   * Italian interface is set as Chinese.
   */
  locale: string | null;
  /** `end` arrived. Only then may markers be matched against the prose. */
  complete: boolean;
  failure: Failure | null;
}

export type Waiting =
  | { phase: "idle" }
  | { phase: "queued" }
  | { phase: "streaming" }
  /** Refused as busy, waiting out attempt `attempt` of `MAX_BUSY_RETRIES`. */
  | { phase: "retrying"; seconds: number; attempt: number }
  | { phase: "stopped"; failure: Failure };

interface AskState {
  turns: Turn[];
  waiting: Waiting;
  conversationId: string | null;
}

function blankTurn(key: string, question: string): Turn {
  return {
    key,
    question,
    answer: "",
    citations: [],
    route: null,
    searchMs: null,
    locale: null,
    complete: false,
    failure: null,
  };
}

/**
 * Stored rows back into turns.
 *
 * An assistant row folds into the question above it, which is why the pairing
 * is done here rather than server-side: the wire shape is the messages table,
 * and an exchange is this interface's idea, not the database's.
 */
function replayed(messages: readonly StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push(blankTurn(`stored-${message.id}`, message.text));
      continue;
    }
    const open = turns.at(-1);
    if (open === undefined) continue;
    open.answer = message.text;
    open.citations = message.citations;
    open.route = message.route;
    open.searchMs = message.search_ms;
    open.locale = message.locale;
    open.complete = message.complete;
    if (!message.complete) open.failure = { kind: "interrupted" };
  }
  return turns;
}

/**
 * The stored rows without the answer `answering` and its question, which its
 * stream gives back from the start. Its question is the row before it, since
 * the answer hangs from it and is the thread's leaf. Neither is there yet while
 * the question waits for a worker: both are written at `start`.
 */
function withoutAnswer(
  messages: readonly StoredMessage[],
  answering: string,
): readonly StoredMessage[] {
  const at = messages.findIndex((message) => message.id === answering);
  return at === -1 ? messages : messages.slice(0, at - 1);
}

/**
 * What a visitor's question carries back: the server's `recent_turns`
 * (apps/qa/conversations.py), done on this side.
 *
 * The same turns the server would have stored: only those that reached `start`,
 * which is where a stored conversation writes its rows, so a question refused
 * with a 503 leaves no hole. An interrupted answer goes as it stands, since it
 * is what the reader saw. Answers are cut to the server's cap; the prompt keeps
 * less than that anyway. The cut counts code points, as the server does, and
 * not UTF-16 units: a cut inside a character outside the BMP leaves half of it
 * behind, which the server refuses.
 */
export function historyOf(turns: readonly Turn[]): HistoryTurn[] {
  return turns
    .filter((turn) => turn.route !== null)
    .slice(-HISTORY_WINDOW_TURNS)
    .map((turn) => ({
      question: turn.question,
      answer: Array.from(turn.answer).slice(0, MAX_HISTORY_ANSWER_CHARS).join(""),
    }));
}

function sleep(seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, seconds * 1000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/** `visitor`: nobody is signed in, so nothing is stored and the history travels. */
export function useAsk(visitor: boolean) {
  const [state, setState] = useState<AskState>({
    turns: [],
    waiting: { phase: "idle" },
    conversationId: null,
  });
  const abort = useRef<AbortController | null>(null);
  /**
   * The id the next request will carry.
   *
   * A ref as well as state, and the duplication is the point: a callback that
   * read the id out of state would be holding whatever it was when the callback
   * was made, and the id a first question is given arrives in the middle of that
   * very request. The state copy is what the URL and the sidebar highlight read;
   * this one is what goes on the wire. They are written together, once, when
   * `start` arrives. Not at `queued`, which names the conversation too: a new
   * one has no rows until `start` writes them, and reading it before that is a
   * 404, so the URL must not name it sooner.
   */
  const opened = useRef<string | null>(null);
  /** The answer being written, as its `queued` event named it: what Stop stops. */
  const answering = useRef<string | null>(null);

  // A visitor's answer stops when its connection closes, so leaving the page
  // must close it rather than leave it open behind the page.
  useEffect(() => () => abort.current?.abort(), []);

  /** Stops reading whatever the page reads. */
  const halt = useCallback(() => {
    abort.current?.abort();
    answering.current = null;
  }, []);

  /** The controller of the next request, the one before it aborted. */
  const renew = useCallback(() => {
    halt();
    const controller = new AbortController();
    abort.current = controller;
    return controller;
  }, [halt]);

  // An answer still being written comes back from its stream, from the start:
  // its rows hold nothing of it until the end, or are not there yet. Resolves
  // once that answer has settled, at once when there is none.
  const adopt = useCallback(
    async (conversation: ConversationDetail): Promise<void> => {
      const controller = renew();
      const live = conversation.answering;
      opened.current = conversation.id;
      setState({
        turns: replayed(
          live === null ? conversation.messages : withoutAnswer(conversation.messages, live),
        ),
        waiting: { phase: live === null ? "idle" : "queued" },
        conversationId: conversation.id,
      });
      if (live === null) return;

      const page = { setState, opened, answering, signal: controller.signal };
      try {
        await read(page, `live-${live}`, await resumeAnswer(live, null, controller.signal), true);
      } catch (error) {
        if (controller.signal.aborted) return;
        failed(page, `live-${live}`, asApiError(error));
      }
    },
    [renew],
  );

  const reset = useCallback(() => {
    halt();
    opened.current = null;
    setState({ turns: [], waiting: { phase: "idle" }, conversationId: null });
  }, [halt]);

  // The server is told and not waited for: a stop that never arrives leaves a
  // student's answer to finish and be stored, which the next reading of the
  // conversation shows, and leaves nothing on this page to put right.
  const stop = useCallback(() => {
    const id = answering.current;
    if (id !== null) void stopAnswer(id).catch(() => undefined);
    halt();
    setState((current) => ({ ...current, waiting: { phase: "idle" } }));
  }, [halt]);

  // A visitor's history is taken before this question joins the thread, and
  // once: a busy retry sends the same request again. Resolves to the refusal
  // that ended the question, `null` when it was answered or stopped.
  const submit = useCallback(
    async (question: string): Promise<ApiError | null> => {
      const controller = renew();
      const page = { setState, opened, answering, signal: controller.signal };
      const body = visitor
        ? { question, history: historyOf(state.turns) }
        : { question, conversation_id: opened.current };

      const key = `live-${Date.now()}`;
      setState((current) => ({
        ...current,
        waiting: { phase: "queued" },
        turns: [...current.turns, blankTurn(key, question)],
      }));

      for (let attempt = 0; ; attempt += 1) {
        try {
          const stream = await ask(body, controller.signal);
          await read(page, key, stream, !visitor);
          return null;
        } catch (error) {
          if (controller.signal.aborted) return null;

          const refusal = asApiError(error);
          if (refusal.code !== "UNAVAILABLE" || attempt >= MAX_BUSY_RETRIES) {
            failed(page, key, refusal);
            return refusal;
          }

          // The server's own hint, and there always is one on a 503 from this
          // endpoint; the fallback is for an answer that lost it on the way.
          const hint = refusal.data.retry_after_seconds;
          const seconds = typeof hint === "number" ? hint : 30;
          settle(page, { phase: "retrying", seconds, attempt: attempt + 1 });
          try {
            await sleep(seconds, controller.signal);
          } catch {
            return null; // aborted while waiting for room
          }
          settle(page, { phase: "queued" });
        }
      }
    },
    [visitor, state.turns, renew],
  );

  return { ...state, submit, adopt, reset, stop };
}

/** What an answer's stream writes to: the hook's state, the ids it keeps by hand, and its request's signal. */
interface Page {
  setState: (update: (current: AskState) => AskState) => void;
  opened: { current: string | null };
  answering: { current: string | null };
  signal: AbortSignal;
}

function patch(page: Page, key: string, change: Partial<Turn>): void {
  page.setState((current) => ({
    ...current,
    turns: current.turns.map((turn) => (turn.key === key ? { ...turn, ...change } : turn)),
  }));
}

function settle(page: Page, waiting: Waiting): void {
  page.setState((current) => ({ ...current, waiting }));
}

function failed(page: Page, key: string, error: ApiError): void {
  const failure: Failure = { kind: "failed", error };
  patch(page, key, { failure });
  settle(page, { phase: "stopped", failure });
}

/**
 * Whatever was thrown, as the reader can tell it: what is not a coded refusal
 * is the connection — the request never reached the server, or the stream
 * broke off.
 */
function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({ status: 0, code: "NETWORK" });
}

/**
 * One answer's stream read into the turn `key`, and the page settled by how it
 * ended.
 *
 * Throws whatever `follow` threw. An `error` event inside the stream is not a
 * throw: by then the status code is long spent, the fragment already on
 * screen is worth keeping, and retrying would ask the same question twice.
 */
async function read(page: Page, key: string, stream: Answering, resumable: boolean): Promise<void> {
  const ending = await follow(
    stream,
    resumable,
    {
      queued: (event) => {
        page.answering.current = event.answer_id;
        // A reloaded page hears of the question here first.
        page.setState((current) =>
          current.turns.some((turn) => turn.key === key)
            ? current
            : { ...current, turns: [...current.turns, blankTurn(key, event.question)] },
        );
      },
      start: (event) => {
        patch(page, key, {
          citations: event.citations,
          route: event.route,
          searchMs: event.search_ms,
          locale: event.locale,
        });
        page.opened.current = event.conversation_id;
        page.setState((current) => ({
          ...current,
          conversationId: event.conversation_id,
          waiting: { phase: "streaming" },
        }));
      },
      text: (answer) => patch(page, key, { answer }),
    },
    page.signal,
  );

  // An ending that arrives after the reader moved on is not theirs to see.
  if (page.signal.aborted) return;
  page.answering.current = null;
  switch (ending.kind) {
    case "end":
      patch(page, key, { complete: true });
      settle(page, { phase: "idle" });
      break;
    case "stopped": {
      const failure: Failure = { kind: "interrupted" };
      patch(page, key, { failure });
      settle(page, { phase: "stopped", failure });
      break;
    }
    case "failed":
      failed(page, key, ending.error);
      break;
  }
}
