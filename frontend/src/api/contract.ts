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

/** `rag.agent.RouteDecision` — the router owns this schema. */
export interface RouteDecision {
  target: "slides" | "unifi_web" | "both";
  query: string;
  fresh: boolean;
  reason: string;
}

/**
 * One retrieved excerpt. `marker` is the exact bracketed label the model was
 * told to copy into its prose; matching it against the answer is the client's
 * job and is only meaningful once the whole stream has been joined.
 */
export interface Citation {
  marker: string;
  kind: "slides" | "web";
  text: string;
  heading_path: string[];
  course: string;
  locale: string;
  score: number;
  source_file: string;
  page: number;
  url: string | null;
  fetch_date: string | null;
}

/** Everything known before a single token exists. Arrives first, always. */
export interface StartEvent {
  question: string;
  locale: string;
  route: RouteDecision;
  citations: Citation[];
}

/** One piece of the answer, exactly as the model produced it. */
export interface TokenEvent {
  text: string;
}

/** The answer is complete. Empty on purpose: its arrival is the message. */
export type EndEvent = Record<string, never>;

/** Generation failed after the response had already started. */
export interface ErrorEvent {
  detail: string;
}

/**
 * A stream is one `start`, any number of `token`s, and one terminator. A stream
 * that stops without `end` or `error` failed — the client treats a dropped
 * connection and an `error` event the same way.
 */
export type AnswerEvent =
  | { name: "start"; data: StartEvent }
  | { name: "token"; data: TokenEvent }
  | { name: "end"; data: EndEvent }
  | { name: "error"; data: ErrorEvent };

export type AnswerEventName = AnswerEvent["name"];
