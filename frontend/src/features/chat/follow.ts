/**
 * One answer's stream, read to its end whichever response carries it.
 *
 * A worker writes the answer into a stream the server keeps for it
 * (docs/background-tasks.md), so the response a page reads is a window on
 * that stream: the one `POST /api/ask` opened, or one that
 * `GET /api/answers/<id>/events` opens again after a reload. The events are
 * the same either way, and so is what they do to the turn.
 *
 * A signed-in student's connection that drops before the answer's last event
 * is opened again once, after the last event read (`Last-Event-ID`): the worker
 * went on writing meanwhile, and the stream kept it. A second drop is the
 * reader's to see. A visitor's is not opened again: their answer stopped when
 * the connection closed, and the server answers nobody but the student who
 * asked.
 */

import { type Answering, resumeAnswer } from "@/api/client";
import type { QueuedEvent, StartEvent } from "@/api/contract";
import { ApiError, failureOfEvent } from "@/api/http";
import { readAnswerEvents } from "@/api/sse";

/** What the stream says on its way, as the turn needs it. */
export interface Listener {
  queued(event: QueuedEvent): void;
  start(event: StartEvent): void;
  /** The answer so far, after each token. */
  text(answer: string): void;
}

/** How the stream ended: its terminator, or the failure that stands in for one. */
export type Ending = { kind: "end" } | { kind: "stopped" } | { kind: "failed"; error: ApiError };

/**
 * Reads `opened` until the stream's terminator, and reports how it ended.
 *
 * Throws only when `signal` aborted, or on a payload that is not JSON, which
 * is a defect on the server. A connection that drops mid-read rejects the read
 * with a `TypeError`, where one the server closed early just ends: to the
 * reader both are the stream breaking off, and the contract makes a
 * terminator the only end.
 */
export async function follow(
  opened: Answering,
  resumable: boolean,
  listener: Listener,
  signal: AbortSignal,
): Promise<Ending> {
  let stream = opened;
  let answerId: string | null = null;
  let after: string | null = null;
  let answer = "";

  for (let resumed = false; ; resumed = true) {
    try {
      for await (const event of readAnswerEvents(stream.body)) {
        if (event.id !== null) after = event.id;
        switch (event.name) {
          case "queued":
            answerId = event.data.answer_id;
            listener.queued(event.data);
            break;
          case "start":
            listener.start(event.data);
            break;
          case "token":
            answer += event.data.text;
            listener.text(answer);
            break;
          case "end":
            return { kind: "end" };
          case "stopped":
            return { kind: "stopped" };
          case "error":
            return { kind: "failed", error: failureOfEvent(event.data, stream.requestId) };
        }
      }
    } catch (error) {
      if (signal.aborted || !(error instanceof TypeError)) throw error;
    }

    // Its status is the stream's own 200, as an `error` event's is.
    const interrupted: Ending = {
      kind: "failed",
      error: new ApiError({ status: 200, code: "STREAM_INTERRUPTED", requestId: stream.requestId }),
    };
    if (!resumable || resumed || answerId === null || after === null) return interrupted;
    try {
      stream = await resumeAnswer(answerId, after, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return interrupted;
    }
  }
}
