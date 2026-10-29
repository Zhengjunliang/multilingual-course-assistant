/**
 * A server-sent-event reader over `fetch`.
 *
 * `EventSource` cannot be used here: it only issues GET requests, and `/api/ask`
 * is a POST that carries a JSON body and a CSRF header. Reading the body stream
 * by hand also buys the two things the browser API hides — an
 * `AbortController`, which closes the connection the moment a reader navigates
 * away, and a `TextDecoder` in streaming mode, without which a multi-byte
 * character split across two network chunks arrives as mojibake.
 *
 * The framing this parses is the one `apps/qa/contract.py` writes:
 *
 *     id: 1730200004390-0\nevent: token\ndata: {"text": "An ORM "}\n\n
 *
 * A frame is its lines up to a blank one, each a field named before its first
 * colon, in whatever order (the WHATWG HTML standard, section "Server-sent
 * events", outside the repository). A line that opens with the colon is a
 * comment: the server sends one to keep a quiet connection open.
 */

import type { AnswerEvent } from "./contract";

const FRAME_DELIMITER = "\n\n";

export interface SseFrame {
  name: string;
  data: string;
  /** What to send back as `Last-Event-ID` to be given the frames after this one. */
  id: string | null;
}

/**
 * One raw frame, or `null` when the text is not one: a comment alone, or a
 * frame without its `event` or `data` field, which the server never writes.
 *
 * A field the standard defines but the server never writes (`retry`), or one it
 * does not define, is ignored, as the standard says; a second `data` line joins
 * the first with a newline, as it says too.
 */
function parseFrame(frame: string): SseFrame | null {
  let name: string | null = null;
  let data: string | null = null;
  let id: string | null = null;
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") data = data === null ? value : `${data}\n${value}`;
    else if (field === "id") id = value;
  }
  if (name === null || data === null) return null;
  return { name, data, id };
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

/** An event of the answer's stream, with the id a resumed read starts after. */
export type AnswerFrame = AnswerEvent & { id: string | null };

/**
 * Frames, typed.
 *
 * An unknown event name is dropped rather than thrown on: the contract says
 * adding an event is additive, so a client that predates one must not break on
 * it. A malformed payload is a real defect and is left to throw.
 */
export async function* readAnswerEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnswerFrame> {
  for await (const frame of readFrames(body)) {
    const data: unknown = JSON.parse(frame.data);
    switch (frame.name) {
      case "queued":
      case "start":
      case "token":
      case "end":
      case "stopped":
      case "error":
        yield { name: frame.name, data, id: frame.id } as AnswerFrame;
        break;
      default:
        break;
    }
  }
}
