/**
 * A conversation's id comes from the address the reader is on, which they can
 * type, so it reaches the server as one path segment whatever it holds: a
 * slash in it must not name another endpoint.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteConversation, pinConversation, readConversation } from "@/api/conversations";

describe("a conversation's id in the path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["read", () => readConversation("a/b?c")],
    ["pinned", () => pinConversation("a/b?c", true)],
    ["deleted", () => deleteConversation("a/b?c")],
  ])("is one encoded segment when %s", async (_, call) => {
    const asked: string[] = [];
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await call();

    expect(asked).toEqual(["/api/conversations/a%2Fb%3Fc"]);
  });
});
