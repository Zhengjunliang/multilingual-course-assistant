/**
 * One question's life, from submitted to settled.
 *
 * The states are not decoration. `queued` exists because the wait a reader
 * actually feels starts when the POST leaves, not when a 503 comes back: the
 * server answers one question at a time and makes the next one wait up to
 * ninety seconds before refusing it. Showing nothing during that silence is the
 * dishonest part.
 *
 * A `busy` 503 is retried at most twice and then stopped, because an automatic
 * retry that never gives up is a page that looks like it is working while
 * nothing is. `unavailable` is not retried at all — a model server that is not
 * running does not start because we asked again.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { AskFailed, ask } from "@/api/client";
import type { Citation, RouteDecision } from "@/api/contract";
import type { ConversationDetail, StoredMessage } from "@/api/conversations";
import { readAnswerEvents } from "@/api/sse";

export const MAX_BUSY_RETRIES = 2;

/** How far a turn got, when it did not get all the way. */
export type Failure =
  /** The server said why, in words meant for the reader. */
  | { kind: "reported"; detail: string }
  /** The stream stopped without `end`; there is no message, only the absence. */
  | { kind: "incomplete" };

/** One exchange as the interface holds it, live or replayed from the database. */
export interface Turn {
  key: string;
  question: string;
  answer: string;
  citations: Citation[];
  route: RouteDecision | null;
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
    open.complete = message.complete;
    if (!message.complete) open.failure = { kind: "incomplete" };
  }
  return turns;
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

export function useAsk() {
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

  const submit = useCallback(async (question: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

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
        await run(question, opened, controller.signal, patch, settle, setState);
        return;
      } catch (error) {
        if (controller.signal.aborted) return;

        const busy = error instanceof AskFailed && error.reason === "busy";
        if (!busy || attempt >= MAX_BUSY_RETRIES) {
          const failure: Failure = {
            kind: "reported",
            detail: error instanceof Error ? error.message : String(error),
          };
          patch({ failure });
          settle({ phase: "stopped", failure, canRetry: busy });
          return;
        }

        // The server's own hint, and there always is one on a 503 from this
        // endpoint (`Retry-After`); the fallback is for a proxy that stripped it.
        const seconds = (error as AskFailed).retryAfter ?? 30;
        settle({ phase: "retrying", seconds, attempt: attempt + 1 });
        try {
          await sleep(seconds, controller.signal);
        } catch {
          return; // aborted while waiting out the queue
        }
        settle({ phase: "queued" });
      }
    }
  }, []);

  return { ...state, submit, adopt, reset, stop };
}

/**
 * One attempt.
 *
 * Throws whatever `ask` threw, so the retry loop above can read the reason off
 * it. An `error` event *inside* the stream is not a throw: by then the status
 * code is long spent, the fragment already on screen is worth keeping, and
 * retrying would ask the same question twice.
 */
async function run(
  question: string,
  opened: { current: number | null },
  signal: AbortSignal,
  patch: (change: Partial<Turn>) => void,
  settle: (waiting: Waiting) => void,
  setState: (update: (current: AskState) => AskState) => void,
): Promise<void> {
  let answer = "";
  let ended = false;

  const body = await ask({ question, conversation_id: opened.current }, signal);
  settle({ phase: "streaming" });

  for await (const event of readAnswerEvents(body)) {
    switch (event.name) {
      case "start":
        patch({ citations: event.data.citations, route: event.data.route });
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
        const failure: Failure = { kind: "reported", detail: event.data.detail };
        patch({ failure });
        settle({ phase: "stopped", failure, canRetry: false });
        return;
      }
    }
  }

  // The contract makes `end` the completion signal, so a stream that simply
  // stopped is a failure even though every byte of it arrived.
  if (!ended) {
    const failure: Failure = { kind: "incomplete" };
    patch({ failure });
    settle({ phase: "stopped", failure, canRetry: true });
    return;
  }
  patch({ complete: true });
  settle({ phase: "idle" });
}
