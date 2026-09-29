// @vitest-environment jsdom

/**
 * A refusal before the stream, read the way the server writes it.
 *
 * `ask` requests `text/event-stream`, so DRF frames its error bodies as one
 * `error` event (apps/qa/views.py, `ServerSentEventRenderer`;
 * tests/test_qa_api.py pins that framing). Read as JSON, such a body parses to
 * nothing: a busy engine then looked like any other 503, and the automatic
 * retry in `useAsk` never ran. A plain JSON body stays readable too, for a
 * proxy or server that answers without the framing.
 *
 * jsdom only because `ask` reads the CSRF cookie off `document`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { AskFailed, ask } from "@/api/client";

const BUSY = JSON.stringify({ detail: "The engine is busy.", reason: "busy" });

describe("a refused question", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["framed as an error event", `event: error\ndata: ${BUSY}\n\n`, "text/event-stream"],
    ["sent as plain JSON", BUSY, "application/json"],
  ])("keeps the reason and the server's words when %s", async (_, body, type) => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(body, { status: 503, headers: { "Content-Type": type, "Retry-After": "60" } }),
    );

    const failure = await ask({ question: "?" }, new AbortController().signal).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AskFailed);
    expect(failure).toMatchObject({
      status: 503,
      detail: "The engine is busy.",
      reason: "busy",
      retryAfter: 60,
    });
  });
});
