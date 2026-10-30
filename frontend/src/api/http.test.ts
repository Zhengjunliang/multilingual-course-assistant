/**
 * A refused request, read into one coded `ApiError` (#186), and the CSRF
 * token a write sends.
 *
 * The coded body, `{"error": {...}}`, is read as it is; any other body is one
 * the client cannot read. Every refusal comes through `request()`, so it is
 * read here, off a stand-in `fetch`: a `GET` touches no cookie and needs no
 * document. The token is read off a stand-in `document`'s cookies.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, isSessionLost, request, writeHeaders } from "@/api/http";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

function answer(
  status: number,
  body: string,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): void {
  vi.stubGlobal("fetch", async () => new Response(body, { status, headers }));
}

async function refusal(status: number, body: unknown, headers?: Record<string, string>) {
  answer(status, JSON.stringify(body), headers);
  const failure = await request("/api/x").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  return failure as ApiError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a coded refusal", () => {
  it("keeps the code, its values, the refused fields and the request id", async () => {
    const failure = await refusal(400, {
      error: {
        code: "INVALID_ARGUMENT",
        message: "Some fields are not valid.",
        data: {},
        fields: [
          { field: "password", reason: "TOO_SHORT", data: { min_length: 8 } },
          { field: null, reason: "INVALID", data: {} },
        ],
        request_id: ID,
      },
    });

    expect(failure).toMatchObject({
      status: 400,
      code: "INVALID_ARGUMENT",
      data: {},
      violations: [
        { field: "password", reason: "TOO_SHORT", data: { min_length: 8 } },
        { field: null, reason: "INVALID", data: {} },
      ],
      requestId: ID,
    });
  });

  it("does not carry the server's English message", async () => {
    const failure = await refusal(503, {
      error: { code: "ENGINE_DOWN", message: "uv run serve", data: {}, fields: [], request_id: ID },
    });

    expect(failure.message).not.toContain("uv run");
  });

  it("reads a code it does not know as INTERNAL, keeping the request id", async () => {
    const failure = await refusal(418, {
      error: { code: "TEAPOT", message: "…", data: {}, fields: [], request_id: ID },
    });

    expect(failure).toMatchObject({ status: 418, code: "INTERNAL", requestId: ID });
  });

  it("reads a field reason it does not know as INVALID", async () => {
    const failure = await refusal(400, {
      error: {
        code: "INVALID_ARGUMENT",
        message: "…",
        data: {},
        fields: [{ field: "title", reason: "TOO_PURPLE", data: { hue: 3 } }],
        request_id: ID,
      },
    });

    expect(failure.violations).toEqual([{ field: "title", reason: "INVALID", data: {} }]);
  });

  it("reads a body that is not JSON as BAD_RESPONSE, with the header's request id", async () => {
    answer(500, "<h1>Server Error</h1>", { "Content-Type": "text/html", "X-Request-ID": ID });

    const failure = await request("/api/x").catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 500, code: "BAD_RESPONSE", requestId: ID });
  });

  it("reads JSON without the coded error as BAD_RESPONSE, keeping none of its words", async () => {
    const failure = await refusal(404, { detail: "Not found." }, { "X-Request-ID": ID });

    expect(failure).toMatchObject({
      status: 404,
      code: "BAD_RESPONSE",
      data: {},
      violations: [],
      requestId: ID,
    });
    expect(failure.message).not.toContain("Not found");
  });
});

describe("a lost session", () => {
  it.each([
    ["the 401", 401, "UNAUTHENTICATED", true],
    ["a refused permission", 403, "PERMISSION_DENIED", false],
    ["a refused CSRF token", 403, "CSRF_FAILED", false],
    ["a missing page", 404, "NOT_FOUND", false],
  ])("is %s", async (_, status, code, lost) => {
    const body = { error: { code, message: "…", data: {}, fields: [], request_id: ID } };

    expect(isSessionLost(await refusal(status, body))).toBe(lost);
  });

  it("is not a failure that is not the server's answer", () => {
    expect(isSessionLost(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("the token a write carries", () => {
  it.each([
    ["the one Django sets without TLS", "csrftoken=plain", "plain"],
    ["the one Django sets behind TLS", "__Host-csrftoken=hosted", "hosted"],
    [
      "the one behind TLS, beside one left from before",
      "csrftoken=stale; __Host-csrftoken=hosted",
      "hosted",
    ],
    ["none, when there is no token", "sessionid=x", undefined],
  ])("is %s", (_, cookies, token) => {
    vi.stubGlobal("document", { cookie: cookies });

    expect(writeHeaders()["X-CSRFToken"]).toBe(token);
  });

  it("goes with a form without a type, which the browser writes with the parts' boundary", () => {
    vi.stubGlobal("document", { cookie: "csrftoken=plain" });

    expect(writeHeaders(new FormData())).toEqual({ "X-CSRFToken": "plain" });
  });
});
