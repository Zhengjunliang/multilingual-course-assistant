/**
 * `/api/admin/activity` — the superuser's page of background work, a stream of
 * server-sent events (apps/system/views.py): one `snapshot`, then an
 * `activity` event per entry and a `refresh` every so often.
 *
 * The shapes mirror apps/system/contract.py, which is the single source;
 * tests/test_system_contract.py fails when the two drift. None of them names
 * who asked.
 *
 * Read with `fetch`, as an answer's stream is (sse.ts), so that leaving the
 * page aborts it; the feed never ends of its own, and one that ends or breaks
 * is opened again by its reader (features/system/useActivity.ts).
 */

import type { StepName } from "./contract";
import { ApiError, failureOf } from "./http";
import { readFrames } from "./sse";

const ACTIVITY_URL = "/api/admin/activity";

export type ActivityKind = "question" | "upload";

/**
 * A question's admission (`queued`, or `refused` at the cap), `taken` by a
 * worker and its answer's events but the tokens; an upload's statuses, in the
 * order its ingest reaches them.
 */
export type ActivityEvent =
  | "queued"
  | "refused"
  | "taken"
  | "step"
  | "start"
  | "end"
  | "stopped"
  | "error"
  | "parsing"
  | "chunking"
  | "indexing"
  | "ready"
  | "failed";

/** One thing that happened to a question or an upload; the fields below `event` belong to some events only. */
export interface ActivityEntry {
  /** Its stream id, and the SSE id: the first part is when it was written, in ms since the epoch. */
  id: string;
  kind: ActivityKind;
  /** The answer's id for a question, the material's for an upload. */
  task: string;
  event: ActivityEvent;
  /** The worker that wrote it, as `inspect` names it; `null` from the site's own process. */
  worker: string | null;
  /** On `queued` and `refused`: a signed-in asker's opening words; `null` for a visitor's question. */
  question: string | null;
  /** On `queued` and `refused`: the asking request's id, the trace's id in Langfuse. */
  request_id: string | null;
  /** On `step`: as `StepEvent`'s `name` and `ms`. */
  step: StepName | null;
  ms: number | null;
  /** On `start`: the excerpts the answer is written from. */
  found: number | null;
  /** On `error`, the error's code; on `failed`, the material's failure. */
  code: string | null;
  /** On an upload's `queued`: the material's file name. */
  file: string | null;
  /** On `indexing`: the passages the material was cut into. */
  chunks: number | null;
}

/** A Celery worker online: its queues, its pool as `celery worker -P` names it, and the tasks it runs at once. */
export interface Worker {
  hostname: string;
  queues: string[];
  pool: string;
  concurrency: number;
}

/** A place taken under the global cap, by an answer waiting for a worker or, once `taken`, being written. */
export interface Seat {
  answer_id: string;
  taken: boolean;
}

/** The feed's first event. `trace_url`, with tracing on, opens a trace once its id is appended. */
export interface Snapshot {
  cap: number;
  retry_after_seconds: number;
  trace_url: string | null;
  seats: Seat[];
  workers: Worker[];
  /** Every entry of the last tasks, oldest first. */
  recent: ActivityEntry[];
}

/** The places and the workers again: a lease that ran out and a worker that left write no entry. */
export interface Refresh {
  seats: Seat[];
  workers: Worker[];
}

/** An event of the feed, typed. */
export type ActivityFrame =
  | { name: "snapshot"; data: Snapshot }
  | { name: "activity"; data: ActivityEntry }
  | { name: "refresh"; data: Refresh };

/** The feed's body to read, or the refusal: a 403 to anyone but the superuser. A GET, as an answer read again is. */
export async function openActivity(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(ACTIVITY_URL, {
    headers: { Accept: "text/event-stream" },
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw await failureOf(response);
  if (response.body === null) {
    const requestId = response.headers.get("X-Request-ID");
    throw new ApiError({ status: response.status, code: "BAD_RESPONSE", requestId });
  }
  return response.body;
}

/** The feed's events as they arrive; an unknown one is dropped, as an answer's is (sse.ts). */
export async function* readActivity(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ActivityFrame> {
  for await (const frame of readFrames(body)) {
    switch (frame.name) {
      case "snapshot":
      case "activity":
      case "refresh":
        yield { name: frame.name, data: JSON.parse(frame.data) } as ActivityFrame;
        break;
      default:
        break;
    }
  }
}
