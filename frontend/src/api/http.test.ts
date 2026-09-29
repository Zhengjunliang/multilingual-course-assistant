/**
 * A refused request, read into an `ApiError` whichever shape DRF gave it.
 *
 * Most of the API answers with plain sentences; the staff endpoints give each
 * message its code (config/exceptions.py). Both come through `request()`, so
 * both are read here, off a stand-in `fetch`: a `GET` touches no cookie and
 * needs no document.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { request } from "@/api/http";

function answer(status: number, body: string, type = "application/json"): void {
  vi.stubGlobal(
    "fetch",
    async () => new Response(body, { status, headers: { "Content-Type": type } }),
  );
}

describe("a refused request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [
      "a sentence for the whole request",
      403,
      { detail: "Nope." },
      { detail: "Nope.", code: null, fields: {}, fieldCodes: {} },
    ],
    [
      "sentences for fields",
      400,
      { username: ["Taken."], password: ["Short.", "Common."] },
      {
        detail: "Taken.",
        code: null,
        fields: { username: ["Taken."], password: ["Short.", "Common."] },
        fieldCodes: {},
      },
    ],
    [
      "a coded refusal of the whole request",
      403,
      { detail: { message: "Needs both.", code: "switch_needs_both" } },
      { detail: "Needs both.", code: "switch_needs_both", fields: {}, fieldCodes: {} },
    ],
    [
      "coded refusals of fields",
      400,
      { username: [{ message: "No such user.", code: "no_such_user" }] },
      {
        detail: "No such user.",
        code: "no_such_user",
        fields: { username: ["No such user."] },
        fieldCodes: { username: ["no_such_user"] },
      },
    ],
  ])("reads %s", async (_, status, body, read) => {
    answer(status, JSON.stringify(body));

    const failure = await request("/api/x").catch((error: unknown) => error);

    expect(failure).toMatchObject({ status, ...read });
  });

  it("reports the status alone when the body is not JSON", async () => {
    answer(404, "<h1>Not Found</h1>", "text/html");

    const failure = await request("/api/x").catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 404, detail: "HTTP 404", code: null, fields: {} });
  });
});
