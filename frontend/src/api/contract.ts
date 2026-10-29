/**
 * The `/api/ask` wire contract, mirrored.
 *
 * The single source is `apps/qa/contract.py`; this file is its shadow on the
 * client. Adding a field there is additive here, renaming one breaks the build.
 * `tests/test_qa_contract.py` reads this file as plain text and asserts every
 * pydantic field name still appears in it, so the two sides cannot drift
 * silently — but it cannot check the types, which is why the names below are
 * copied verbatim rather than camelCased.
 */

import type { ErrorBody } from "./errors";

/** `rag.agent.RouteDecision` — the router owns this schema. */
export interface RouteDecision {
  target: "slides" | "unifi_web" | "both";
  query: string;
  fresh: boolean;
  reason: string;
}

/**
 * One retrieved excerpt. The answer cites it as `[n]`, its place in the list
 * counted from one; `marker` is the bracketed label beside that number in the
 * prompt, which answers generated before 2026-10-12 copied instead. Finding
 * either in the answer is the client's job and is only meaningful once the
 * whole stream has been joined.
 */
export interface Citation {
  marker: string;
  kind: "slides" | "web";
  text: string;
  heading_path: string[];
  course: string;
  /**
   * With `course`, the edition a slides excerpt came from; `null` for web.
   * Absent from citations stored before it existed, so compare with `!= null`.
   */
  academic_year: string | null;
  locale: string;
  score: number;
  source_file: string;
  /**
   * The key the PDF is served under (`api/sources.ts`), for slides only. Absent
   * from citations stored before it existed, so compare with `!= null`.
   */
  source_sha256: string | null;
  page: number;
  url: string | null;
  fetch_date: string | null;
}

/**
 * The question was admitted and waits for a worker. Arrives first, always.
 *
 * `answer_id` names the answer wherever it is kept: the stream a reload reads
 * it back from (`GET /api/answers/<id>/events`) and the stop endpoint
 * (`POST /api/answers/<id>/stop`). `conversation_id` is `StartEvent`'s, known
 * this early; `question` is the question as asked, for a reader who reloads
 * while it waits.
 */
export interface QueuedEvent {
  answer_id: string;
  conversation_id: string | null;
  question: string;
}

/** Everything known before a single token exists. Follows `queued`. */
export interface StartEvent {
  question: string;
  /**
   * Where the answer was filed. A request that named no conversation started
   * one, and this is how the client learns which — the value to send back to
   * make the next question a follow-up. `null` for an anonymous question, which
   * is filed nowhere: the client keeps the thread and sends it back as `history`.
   */
  conversation_id: string | null;
  locale: string;
  route: RouteDecision;
  citations: Citation[];
  /** Milliseconds from the question's admission to this event: the wait for a worker is in it. */
  search_ms: number;
}

/** One piece of the answer, exactly as the model produced it. */
export interface TokenEvent {
  text: string;
}

/** The answer is complete. Empty on purpose: its arrival is the message. */
export type EndEvent = Record<string, never>;

/**
 * The answer was stopped before its end: by the stop endpoint, or, for a
 * visitor, by leaving. Empty, like `end`; what was written is kept unfinished.
 */
export type StoppedEvent = Record<string, never>;

/**
 * The answer failed after the response had already started: `ENGINE_DOWN` for
 * a service that is down, `UNAVAILABLE` for a question no worker took before
 * its lease ran out, `CONVERSATION_GONE` for a conversation deleted while its
 * question waited, `INTERNAL` for a defect.
 */
export interface ErrorEvent {
  error: ErrorBody;
}

/**
 * A stream is one `queued`, one `start`, any number of `token`s, and one
 * terminator: `end`, `stopped` or `error`. A stream that stops with none of
 * them lost its connection, and a signed-in reader can resume it.
 */
export type AnswerEvent =
  | { name: "queued"; data: QueuedEvent }
  | { name: "start"; data: StartEvent }
  | { name: "token"; data: TokenEvent }
  | { name: "end"; data: EndEvent }
  | { name: "stopped"; data: StoppedEvent }
  | { name: "error"; data: ErrorEvent };

export type AnswerEventName = AnswerEvent["name"];
