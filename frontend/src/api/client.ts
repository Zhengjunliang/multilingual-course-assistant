/**
 * The one streaming call, and the failures it can come back with.
 *
 * Everything up to the first event can still be a status code; after it, a
 * failure travels inside the stream as an `error` event. That split is the
 * server's (`apps/qa/views.py`), and it is why `ask` returns a body to read
 * rather than an answer.
 *
 * It does not go through `request()` because nothing about it is JSON in the
 * response direction — what comes back is a body to read frame by frame — but
 * it sends the same CSRF header, from the same helper.
 */

import { ApiError, failureOf, writeHeaders } from "./http";

const ASK_URL = "/api/ask";

/**
 * The server's caps on a request (apps/qa/serializers.py and the history window
 * of apps/qa/models.py), mirrored so a client can stay inside them rather than
 * meet a 400. `tests/test_qa_contract.py` fails when either side moves alone.
 */
export const MAX_QUESTION_CHARS = 1000;
export const HISTORY_WINDOW_TURNS = 3;
export const MAX_HISTORY_ANSWER_CHARS = 4000;

/** One earlier exchange, as an anonymous client sends it back. */
export interface HistoryTurn {
  question: string;
  /** Empty when the answer never arrived. */
  answer: string;
}

/**
 * A question, and how it continues a conversation: a signed-in reader names the
 * stored one, a visitor sends the history itself, `[]` for a first question. A
 * visitor's shape from a signed-in caller is a 400; a signed-in shape without a
 * session is a 403, a session that ended (apps/qa/serializers.py).
 */
export interface AskBody {
  question: string;
  /** Omitted starts a new conversation; the id comes back in the `start` event. */
  conversation_id?: number | null;
  /** A visitor's last exchanges, oldest first, at most `HISTORY_WINDOW_TURNS`. */
  history?: HistoryTurn[];
  /** Omitted means "decide for me" — the engine detects it from the question. */
  locale?: string;
}

/** An answer on its way. */
export interface Answering {
  /** The body to read events from. */
  body: ReadableStream<Uint8Array>;
  /**
   * The response's `X-Request-ID`: a failure inside the stream, after the
   * status, is reported under it.
   */
  requestId: string | null;
}

/**
 * Ask, and hand back the body to read events from.
 *
 * `signal` is not optional by accident: abandoning a stream without aborting it
 * leaves the server generating for nobody and holding its one engine slot.
 */
export async function ask(body: AskBody, signal: AbortSignal): Promise<Answering> {
  const response = await fetch(ASK_URL, {
    method: "POST",
    headers: { ...writeHeaders(), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) throw await failureOf(response);
  const requestId = response.headers.get("X-Request-ID");
  if (response.body === null) {
    throw new ApiError({ status: response.status, code: "BAD_RESPONSE", requestId });
  }
  return { body: response.body, requestId };
}
