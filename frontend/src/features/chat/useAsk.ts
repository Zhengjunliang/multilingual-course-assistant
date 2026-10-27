/**
 * One question's life, from submitted to settled.
 *
 * The states are not decoration. `queued` exists because the wait a reader
 * actually feels starts when the POST leaves, not when a 503 comes back: the
 * server answers one question at a time and makes the next one wait up to
 * ninety seconds before refusing it. Showing nothing during that silence is the
 * dishonest part.
 *
 * An `UNAVAILABLE` 503, the engine busy with another question, is retried at
 * most twice and then stopped, because an automatic retry that never gives up
 * is a page that looks like it is working while nothing is. `ENGINE_DOWN` is
 * not retried at all — a model server or a Qdrant service that is not running
 * does not start because we asked again.
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
  ask,
  HISTORY_WINDOW_TURNS,
  type HistoryTurn,
  MAX_HISTORY_ANSWER_CHARS,
} from "@/api/client";
import type { Citation, RouteDecision } from "@/api/contract";
import type { ConversationDetail, StoredMessage } from "@/api/conversations";
import { ApiError, failureOfEvent } from "@/api/http";
import { readAnswerEvents } from "@/api/sse";

export const MAX_BUSY_RETRIES = 2;

/** How far a turn got, when it did not get all the way. */
export type Failure =
  /** This question's request failed, and the error says how, by its code. */
  | { kind: "failed"; error: ApiError }
  /**
   * A stored answer that stopped before its end, read back with its
   * conversation: the request it came from is long gone.
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
  | { phase: "stopped"; failure: Failure; canRetry: boolean };

interface AskState {
  turns: Turn[];
  waiting: Waiting;
  conversationId: number | null;
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
   * `start` arrives.
   */
  const opened = useRef<number | null>(null);

  // Leaving the page must stop generation, not merely stop listening to it: the
  // server is suspended on a yield holding its one engine slot until the
  // connection actually drops.
  useEffect(() => () => abort.current?.abort(), []);

  const adopt = useCallback((conversation: ConversationDetail) => {
    abort.current?.abort();
    opened.current = conversation.id;
    setState({
      turns: replayed(conversation.messages),
      waiting: { phase: "idle" },
      conversationId: conversation.id,
    });
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    opened.current = null;
    setState({ turns: [], waiting: { phase: "idle" }, conversationId: null });
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    setState((current) => ({ ...current, waiting: { phase: "idle" } }));
  }, []);

  // A visitor's history is taken before this question joins the thread, and
  // once: a busy retry sends the same request again.
  const submit = useCallback(
    async (question: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const history = visitor ? historyOf(state.turns) : null;

      const key = `live-${Date.now()}`;
      const patch = (change: Partial<Turn>) =>
        setState((current) => ({
          ...current,
          turns: current.turns.map((turn) => (turn.key === key ? { ...turn, ...change } : turn)),
        }));
      const settle = (waiting: Waiting) => setState((current) => ({ ...current, waiting }));

      setState((current) => ({
        ...current,
        waiting: { phase: "queued" },
        turns: [...current.turns, blankTurn(key, question)],
      }));

      for (let attempt = 0; ; attempt += 1) {
        try {
          await run(question, history, opened, controller.signal, patch, settle, setState);
          return;
        } catch (error) {
          if (controller.signal.aborted) return;

          // Whatever else threw is the connection, as far as the reader can
          // tell: the request never reached the server, or the stream broke off.
          const failed =
            error instanceof ApiError ? error : new ApiError({ status: 0, code: "NETWORK" });
          const busy = failed.code === "UNAVAILABLE";
          if (!busy || attempt >= MAX_BUSY_RETRIES) {
            const failure: Failure = { kind: "failed", error: failed };
            patch({ failure });
            settle({ phase: "stopped", failure, canRetry: busy });
            return;
          }

          // The server's own hint, and there always is one on a 503 from this
          // endpoint; the fallback is for an answer that lost it on the way.
          const hint = failed.data.retry_after_seconds;
          const seconds = typeof hint === "number" ? hint : 30;
          settle({ phase: "retrying", seconds, attempt: attempt + 1 });
          try {
            await sleep(seconds, controller.signal);
          } catch {
            return; // aborted while waiting out the queue
          }
          settle({ phase: "queued" });
        }
      }
    },
    [visitor, state.turns],
  );

  return { ...state, submit, adopt, reset, stop };
}

/**
 * One attempt.
 *
 * Throws whatever `ask` threw, so the retry loop above can read the code off
 * it. An `error` event *inside* the stream is not a throw: by then the status
 * code is long spent, the fragment already on screen is worth keeping, and
 * retrying would ask the same question twice.
 */
async function run(
  question: string,
  history: HistoryTurn[] | null,
  opened: { current: number | null },
  signal: AbortSignal,
  patch: (change: Partial<Turn>) => void,
  settle: (waiting: Waiting) => void,
  setState: (update: (current: AskState) => AskState) => void,
): Promise<void> {
  let answer = "";
  let ended = false;

  const { body, requestId } = await ask(
    history === null ? { question, conversation_id: opened.current } : { question, history },
    signal,
  );
  settle({ phase: "streaming" });

  for await (const event of readAnswerEvents(body)) {
    switch (event.name) {
      case "start":
        patch({
          citations: event.data.citations,
          route: event.data.route,
          searchMs: event.data.search_ms,
          locale: event.data.locale,
        });
        opened.current = event.data.conversation_id;
        setState((current) => ({ ...current, conversationId: event.data.conversation_id }));
        break;
      case "token":
        answer += event.data.text;
        patch({ answer });
        break;
      case "end":
        ended = true;
        break;
      case "error": {
        const failure: Failure = { kind: "failed", error: failureOfEvent(event.data, requestId) };
        patch({ failure });
        settle({ phase: "stopped", failure, canRetry: false });
        return;
      }
    }
  }

  // The contract makes `end` the completion signal, so a stream that simply
  // stopped is a failure even though every byte of it arrived. Its status is
  // the stream's own 200, as an `error` event's is.
  if (!ended) {
    const failure: Failure = {
      kind: "failed",
      error: new ApiError({ status: 200, code: "STREAM_INTERRUPTED", requestId }),
    };
    patch({ failure });
    settle({ phase: "stopped", failure, canRetry: true });
    return;
  }
  patch({ complete: true });
  settle({ phase: "idle" });
}
