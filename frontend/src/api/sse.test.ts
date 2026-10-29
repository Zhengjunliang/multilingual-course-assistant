import { describe, expect, it } from "vitest";
import { readAnswerEvents, readFrames } from "@/api/sse";

/** A body stream carrying these strings as chunks, in order. */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** The same, when the split has to fall between two bytes of one character. */
function byteStreamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

// Frames of apps/qa/contract.py's docstring. `token` and `end` are copied from
// it verbatim; `start` cannot be, because the docstring abbreviates its route
// and citations as `{...}` and `[...]`, which is not JSON. The field names
// below are the ones the docstring lists, in its order.
const START_FRAME =
  'id: 1730200004211-0\nevent: start\ndata: {"question": "What is an ORM?", ' +
  '"conversation_id": "3f1c9a52-6b0e-4d7a-9c1e-2a5b8d4f0e17", ' +
  '"locale": "en", "route": {"target": "slides", "query": "ORM", "fresh": false, ' +
  '"reason": "course material"}, "citations": []}\n\n';
const TOKEN_FRAME = 'id: 1730200004390-0\nevent: token\ndata: {"text": "An ORM "}\n\n';
const END_FRAME = "id: 1730200009120-0\nevent: end\ndata: {}\n\n";

describe("readFrames", () => {
  it.each([
    ["has no data field", "event: end\n\n"],
    ["has no event field", 'id: 1-0\ndata: {"text": "x"}\n\n'],
    ["names its data field otherwise", 'event: token\nfoo: {"text": "x"}\n\n'],
    ["is a comment alone", ": keepalive\n\n"],
  ])("drops a frame that %s and still delivers the next one", async (_, malformed) => {
    const frames = await collect(readFrames(streamOf([malformed + TOKEN_FRAME])));
    expect(frames.map((frame) => frame.name)).toEqual(["token"]);
  });

  it("reads the fields in any order, past a comment line, with the id", async () => {
    // The standard names fields, it does not order them: a reader that took
    // the first line for the event would drop every frame the server writes.
    const frames = await collect(
      readFrames(streamOf([': keepalive\ndata: {"text": "x"}\nevent: token\nid: 7-1\n\n'])),
    );
    expect(frames).toEqual([{ name: "token", data: '{"text": "x"}', id: "7-1" }]);
  });

  it("gives a frame without an id a null one", async () => {
    const frames = await collect(readFrames(streamOf(["event: end\ndata: {}\n\n"])));
    expect(frames).toEqual([{ name: "end", data: "{}", id: null }]);
  });

  it("releases three frames arriving in one chunk", async () => {
    const frames = await collect(readFrames(streamOf([START_FRAME + TOKEN_FRAME + END_FRAME])));
    expect(frames.map((frame) => frame.name)).toEqual(["start", "token", "end"]);
  });

  it("buffers a frame cut in the middle of its data line", async () => {
    // The boundary that matters most: the network split falls inside the
    // payload, so neither half is a frame.
    const frames = await collect(
      readFrames(streamOf(['event: token\ndata: {"te', 'xt": "An ORM "}\n\n'])),
    );
    expect(frames).toEqual([{ name: "token", data: '{"text": "An ORM "}', id: null }]);
  });

  it("never releases a frame that has no blank line after it", async () => {
    // A dropped connection mid-frame must not look like a delivered event.
    expect(await collect(readFrames(streamOf(["event: end\ndata: {}"])))).toEqual([]);
  });

  it("decodes a character whose bytes land in different chunks", async () => {
    // The reason the decoder runs in streaming mode. "è" is two bytes in UTF-8;
    // split between them, a non-streaming decode yields mojibake instead.
    const bytes = new TextEncoder().encode('event: token\ndata: {"text": "è"}\n\n');
    const split = bytes.indexOf(0xc3) + 1;
    expect(split).toBeGreaterThan(0);
    const frames = await collect(
      readFrames(byteStreamOf([bytes.slice(0, split), bytes.slice(split)])),
    );
    expect(frames).toEqual([{ name: "token", data: '{"text": "è"}', id: null }]);
  });
});

describe("readAnswerEvents", () => {
  it("routes the six names of the contract and carries their payloads and ids through", async () => {
    const events = await collect(
      readAnswerEvents(
        streamOf([
          'event: queued\ndata: {"answer_id": "9b2e", "conversation_id": null, "question": "q"}\n\n',
          START_FRAME,
          TOKEN_FRAME,
          'event: error\ndata: {"detail": "gone"}\n\n',
          "event: stopped\ndata: {}\n\n",
          END_FRAME,
        ]),
      ),
    );
    expect(events.map((event) => event.name)).toEqual([
      "queued",
      "start",
      "token",
      "error",
      "stopped",
      "end",
    ]);
    expect(events[0]).toEqual({
      name: "queued",
      data: { answer_id: "9b2e", conversation_id: null, question: "q" },
      id: null,
    });
    // Every field of START_FRAME is asserted here, and that is the point of
    // spelling the fixture out: without this the payload could be `{}` and the
    // suite would stay green while the fixture's comment claimed otherwise.
    expect(events[1]).toEqual({
      name: "start",
      data: {
        question: "What is an ORM?",
        conversation_id: "3f1c9a52-6b0e-4d7a-9c1e-2a5b8d4f0e17",
        locale: "en",
        route: { target: "slides", query: "ORM", fresh: false, reason: "course material" },
        citations: [],
      },
      id: "1730200004211-0",
    });
    expect(events[2]).toEqual({ name: "token", data: { text: "An ORM " }, id: "1730200004390-0" });
    expect(events[3]).toEqual({ name: "error", data: { detail: "gone" }, id: null });
    expect(events[5]).toEqual({ name: "end", data: {}, id: "1730200009120-0" });
  });

  it("drops an unknown event and delivers the ones around it", async () => {
    // This is the contract's "adding an event is additive" promise, stated as a
    // test: a client written today must survive an event invented tomorrow.
    const events = await collect(
      readAnswerEvents(
        streamOf([START_FRAME, "event: heartbeat\ndata: {}\n\n", TOKEN_FRAME, END_FRAME]),
      ),
    );
    expect(events.map((event) => event.name)).toEqual(["start", "token", "end"]);
  });

  it("throws on a payload that is not JSON", async () => {
    // A malformed payload is a defect on the server, not an event to skip.
    await expect(
      collect(readAnswerEvents(streamOf(["event: token\ndata: not json\n\n"]))),
    ).rejects.toThrow();
  });
});
