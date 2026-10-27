/**
 * A refusal before the stream, read the way the server writes it.
 *
 * `ask` requests `text/event-stream`, so DRF frames its error bodies as one
 * `error` event (apps/qa/views.py, `ServerSentEventRenderer`;
 * tests/test_qa_api.py pins that framing). Read as JSON, such a body parses to
 * nothing: a busy engine then looked like any other 503, and the automatic
 * retry in `useAsk` never ran. A plain JSON body stays readable too, for a
 * proxy or server that answers without the framing; and the coded body (#186)
 * reads the same as the old one.
 *
 * `ask` reads the CSRF cookie off `document`, the one browser object it needs,
 * so a stand-in for that is enough and the file stays off jsdom.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ask } from "@/api/client";
import { ApiError } from "@/api/http";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const OLD = JSON.stringify({ detail: "The engine is busy.", reason: "busy" });
const CODED = JSON.stringify({
  error: {
    code: "UNAVAILABLE",
    message: "The engine is busy.",
    data: { retry_after_seconds: 60 },
    fields: [],
    request_id: ID,
  },
});

describe("a refused question", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [
      "the old body framed as an error event",
      `event: error\ndata: ${OLD}\n\n`,
      "text/event-stream",
    ],
    ["the old body sent as plain JSON", OLD, "application/json"],
    [
      "the coded body framed as an error event",
      `event: error\ndata: ${CODED}\n\n`,
      "text/event-stream",
    ],
  ])("reads a busy engine from %s", async (_, body, type) => {
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(body, {
          status: 503,
          headers: { "Content-Type": type, "Retry-After": "60", "X-Request-ID": ID },
        }),
    );

    const failure = await ask({ question: "?" }, new AbortController().signal).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 503,
      code: "UNAVAILABLE",
      data: { retry_after_seconds: 60 },
      requestId: ID,
      reason: "busy",
      retryAfter: 60,
    });
  });
});
