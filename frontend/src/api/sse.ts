/**
 * A server-sent-event reader over `fetch`.
 *
 * `EventSource` cannot be used here: it only issues GET requests, and `/api/ask`
 * is a POST that carries a JSON body (and, from the login stage on, a CSRF
 * header). Reading the body stream by hand also buys the two things the browser
 * API hides — an `AbortController`, which is what returns the server's process
 * lock the moment a reader navigates away, and a `TextDecoder` in streaming
 * mode, without which a multi-byte character split across two network chunks
 * arrives as mojibake.
 *
 * The framing this parses is the one `apps/qa/contract.py` writes:
 *
 *     event: token\ndata: {"text": "An ORM "}\n\n
 *
 * A `data:` field ends at the first newline and the payload is always JSON, so
 * a frame is exactly two lines and the blank line after it is the delimiter.
 */

import type { AnswerEvent } from "./contract";

const FRAME_DELIMITER = "\n\n";
const EVENT_FIELD = "event: ";
const DATA_FIELD = "data: ";

export interface SseFrame {
  name: string;
  data: string;
}

/**
 * One raw frame, or `null` when the text is not one.
 *
 * Exported for its own test: the chunk boundary that matters most is the one
 * that falls inside a `data:` line, and that case is unreachable from outside
 * unless the split can be staged deliberately.
 */
export function parseFrame(frame: string): SseFrame | null {
  const newline = frame.indexOf("\n");
  if (newline === -1) return null;
  const nameLine = frame.slice(0, newline);
  const dataLine = frame.slice(newline + 1);
  if (!nameLine.startsWith(EVENT_FIELD) || !dataLine.startsWith(DATA_FIELD)) return null;
  return { name: nameLine.slice(EVENT_FIELD.length), data: dataLine.slice(DATA_FIELD.length) };
}

/**
 * Frames as they arrive, buffering across chunk boundaries.
 *
 * A chunk carries whatever the network gave it: half a frame, three frames, or
 * a frame split mid-word. Only a complete `\n\n` releases one.
 */
export async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf(FRAME_DELIMITER);
        if (boundary === -1) break;
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + FRAME_DELIMITER.length);
        if (frame !== null) yield frame;
      }
    }
  } finally {
    // Releasing rather than cancelling: the caller's AbortController owns the
    // request, and cancelling here would race it.
    reader.releaseLock();
  }
}

/**
 * Frames, typed.
 *
 * An unknown event name is dropped rather than thrown on: the contract says
 * adding an event is additive, so a client that predates one must not break on
 * it. A malformed payload is a real defect and is left to throw.
 */
export async function* readAnswerEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnswerEvent> {
  for await (const frame of readFrames(body)) {
    const data: unknown = JSON.parse(frame.data);
    switch (frame.name) {
      case "start":
      case "token":
      case "end":
      case "error":
        yield { name: frame.name, data } as AnswerEvent;
        break;
      default:
        break;
    }
  }
}
