import { describe, expect, it } from "vitest";
import { parseFrame, readAnswerEvents, readFrames } from "@/api/sse";

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

// The three frames of apps/qa/contract.py's docstring. `token` and `end` are
// copied from it verbatim; `start` cannot be, because the docstring abbreviates
// its route and citations as `{...}` and `[...]`, which is not JSON. The field
// names below are the ones the docstring lists, in its order.
const START_FRAME =
  'event: start\ndata: {"question": "What is an ORM?", "conversation_id": 7, ' +
  '"locale": "en", "route": {"target": "slides", "query": "ORM", "fresh": false, ' +
  '"reason": "course material"}, "citations": []}\n\n';
const TOKEN_FRAME = 'event: token\ndata: {"text": "An ORM "}\n\n';
const END_FRAME = "event: end\ndata: {}\n\n";

describe("parseFrame", () => {
  it("refuses a frame with no newline", () => {
    // Narrower than "is not two lines" on purpose: a third line is not
    // rejected, it lands inside `data`. Saying "two lines" here would promise
    // a check the implementation does not make.
    expect(parseFrame("event: end")).toBeNull();
  });

  it("refuses a frame whose fields are not event and data", () => {
    expect(parseFrame('id: 1\ndata: {"text": "x"}')).toBeNull();
    expect(parseFrame('event: token\nfoo: {"text": "x"}')).toBeNull();
  });

  it("splits the name from the payload", () => {
    expect(parseFrame('event: token\ndata: {"text": "x"}')).toEqual({
      name: "token",
      data: '{"text": "x"}',
    });
  });
});

describe("readFrames", () => {
  it("releases three frames arriving in one chunk", async () => {
    const frames = await collect(readFrames(streamOf([START_FRAME + TOKEN_FRAME + END_FRAME])));
    expect(frames.map((frame) => frame.name)).toEqual(["start", "token", "end"]);
  });

  it("buffers a frame cut in the middle of its data line", async () => {
    // The boundary the module's own docstring calls the one that matters: the
    // network split falls inside the payload, so neither half is a frame.
    const frames = await collect(
      readFrames(streamOf(['event: token\ndata: {"te', 'xt": "An ORM "}\n\n'])),
    );
    expect(frames).toEqual([{ name: "token", data: '{"text": "An ORM "}' }]);
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
    expect(frames).toEqual([{ name: "token", data: '{"text": "è"}' }]);
  });
});

describe("readAnswerEvents", () => {
  it("routes the four names of the contract and carries their payloads through", async () => {
    const events = await collect(
      readAnswerEvents(
        streamOf([
          START_FRAME,
          TOKEN_FRAME,
          'event: error\ndata: {"detail": "gone"}\n\n',
          END_FRAME,
        ]),
      ),
    );
    expect(events.map((event) => event.name)).toEqual(["start", "token", "error", "end"]);
    // Every field of START_FRAME is asserted here, and that is the point of
    // spelling the fixture out: without this the payload could be `{}` and the
    // suite would stay green while the fixture's comment claimed otherwise.
    expect(events[0]).toEqual({
      name: "start",
      data: {
        question: "What is an ORM?",
        conversation_id: 7,
        locale: "en",
        route: { target: "slides", query: "ORM", fresh: false, reason: "course material" },
        citations: [],
      },
    });
    expect(events[1]).toEqual({ name: "token", data: { text: "An ORM " } });
    expect(events[2]).toEqual({ name: "error", data: { detail: "gone" } });
    expect(events[3]).toEqual({ name: "end", data: {} });
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
