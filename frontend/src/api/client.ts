/**
 * The streaming calls, the failures they can come back with, and the stop.
 *
 * Everything up to the first event can still be a status code; after it, a
 * failure travels inside the stream as an `error` event. That split is the
 * server's (`apps/qa/views.py`), and it is why `ask` and `resumeAnswer` return
 * a body to read rather than an answer.
 *
 * They do not go through `request()` because nothing about them is JSON in the
 * response direction — what comes back is a body to read frame by frame — but
 * `ask` sends the same CSRF header, from the same helper.
 */

import { ApiError, failureOf, request, writeHeaders } from "./http";

const ASK_URL = "/api/ask";

function answerPath(id: string): string {
  return `/api/answers/${encodeURIComponent(id)}`;
}

/**
 * The server's caps on a request (apps/qa/serializers.py and the history window
 * of apps/qa/models.py), mirrored so a client can stay inside them rather than
 * meet a 400. `tests/test_qa_contract.py` fails when either side moves alone.
 */
export const MAX_QUESTION_CHARS = 1000;
export const HISTORY_WINDOW_TURNS = 3;
export const MAX_HISTORY_ANSWER_CHARS = 4000;
export const MAX_ADDED_EDITIONS = 50;

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
  /**
   * Omitted starts a new conversation; the id comes back in the `start` event.
   * Anything but a UUID string is a 400 on this field.
   */
  conversation_id?: string | null;
  /** A visitor's last exchanges, oldest first, at most `HISTORY_WINDOW_TURNS`. */
  history?: HistoryTurn[];
  /**
   * The editions this question and the conversation's later ones search
   * besides the default, by id: omitted keeps what the conversation holds,
   * `[]` clears it, at most `MAX_ADDED_EDITIONS`. One outside the caller's
   * boundary is a 403. Signed in only.
   */
  added_editions?: number[];
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

async function answering(response: Response): Promise<Answering> {
  if (!response.ok) throw await failureOf(response);
  const requestId = response.headers.get("X-Request-ID");
  if (response.body === null) {
    throw new ApiError({ status: response.status, code: "BAD_RESPONSE", requestId });
  }
  return { body: response.body, requestId };
}

/**
 * Ask, and hand back the body to read events from.
 *
 * `signal` is not optional by accident: a visitor's answer is stopped by the
 * connection closing, so a stream abandoned without aborting it leaves a
 * worker writing for nobody and holding a place under the server's cap.
 */
export async function ask(body: AskBody, signal: AbortSignal): Promise<Answering> {
  const response = await fetch(ASK_URL, {
    method: "POST",
    headers: { ...writeHeaders(), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  return answering(response);
}

/**
 * A signed-in student's answer read again: from its start when `after` is
 * `null`, which is what a reloaded page needs, or from the event after `after`,
 * the id of the last one read, when the connection dropped. A GET, so nothing
 * to protect from cross-site requests.
 */
export async function resumeAnswer(
  id: string,
  after: string | null,
  signal: AbortSignal,
): Promise<Answering> {
  const response = await fetch(`${answerPath(id)}/events`, {
    headers: { Accept: "text/event-stream", ...(after === null ? {} : { "Last-Event-ID": after }) },
    credentials: "same-origin",
    signal,
  });
  return answering(response);
}

/**
 * Stop an answer being written. Safe to repeat: an answer that already ended
 * is a 204 too. The id is the one the answer's `queued` event named.
 */
export function stopAnswer(id: string): Promise<void> {
  return request<void>(`${answerPath(id)}/stop`, { method: "POST" });
}
