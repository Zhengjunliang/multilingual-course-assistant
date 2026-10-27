/**
 * A refused request, read into one coded `ApiError` whichever body the server
 * sent (#186).
 *
 * The coded body, `{"error": {...}}`, is read as it is; the shapes from before
 * it — DRF's plain sentences, and the staff endpoints' `{"message", "code"}`
 * (config/exceptions.py) — are read into the codes they will answer with. Both
 * come through `request()`, so both are read here, off a stand-in `fetch`: a
 * `GET` touches no cookie and needs no document.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { StaffErrorCode } from "@/api/catalog";
import type { ErrorCode, FieldReason } from "@/api/errors";
import { ApiError, isSessionLost, request } from "@/api/http";

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
      legacyText: null,
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
});

describe("a refusal in the old body shape", () => {
  it("reads a sentence for the whole request by its status, keeping the sentence", async () => {
    const failure = await refusal(404, { detail: "Nope." }, { "X-Request-ID": ID });

    expect(failure).toMatchObject({
      code: "NOT_FOUND",
      legacyText: "Nope.",
      violations: [],
      requestId: ID,
      detail: "Nope.",
    });
  });

  it("reads sentences for fields as INVALID, each keeping its sentence", async () => {
    const failure = await refusal(400, {
      username: ["Taken."],
      password: ["Short.", "Common."],
      non_field_errors: ["Wrong."],
    });

    expect(failure).toMatchObject({
      code: "INVALID_ARGUMENT",
      legacyText: null,
      violations: [
        { field: "username", reason: "INVALID", data: {}, legacyText: "Taken." },
        { field: "password", reason: "INVALID", data: {}, legacyText: "Short." },
        { field: "password", reason: "INVALID", data: {}, legacyText: "Common." },
        { field: null, reason: "INVALID", data: {}, legacyText: "Wrong." },
      ],
      detail: "Taken.",
      fields: {
        username: ["Taken."],
        password: ["Short.", "Common."],
        non_field_errors: ["Wrong."],
      },
    });
  });

  it("reads a throttled request with the seconds of its Retry-After header", async () => {
    const failure = await refusal(429, { detail: "Slow down." }, { "Retry-After": "42" });

    expect(failure).toMatchObject({
      code: "RESOURCE_EXHAUSTED",
      data: { retry_after_seconds: 42 },
      retryAfter: 42,
    });
  });

  // The staff endpoints' 13 codes (apps/catalog/errors.py), each with the code
  // and the field reasons it becomes; `Record` makes a code left out fail `tsc`.
  const STAFF: Record<StaffErrorCode, [ErrorCode, FieldReason[]]> = {
    no_such_user: ["INVALID_ARGUMENT", ["NO_SUCH_USER"]],
    already_held: ["ROLE_ALREADY_HELD", []],
    required: ["INVALID_ARGUMENT", ["REQUIRED"]],
    blank: ["INVALID_ARGUMENT", ["REQUIRED"]],
    not_authenticated: ["UNAUTHENTICATED", []],
    permission_denied: ["PERMISSION_DENIED", []],
    not_found: ["NOT_FOUND", []],
    max_length: ["INVALID_ARGUMENT", ["TOO_LONG"]],
    invalid: ["INVALID_ARGUMENT", ["INVALID"]],
    invalid_choice: ["INVALID_ARGUMENT", ["INVALID"]],
    min_value: ["INVALID_ARGUMENT", ["TOO_SMALL"]],
    max_value: ["INVALID_ARGUMENT", ["TOO_LARGE"]],
    unique: ["INVALID_ARGUMENT", ["ALREADY_EXISTS"]],
  };

  it.each(Object.entries(STAFF))(
    "reads the staff code %s on a field",
    async (code, [read, reasons]) => {
      const failure = await refusal(400, { title: [{ message: "…", code }] });

      expect([failure.code, failure.violations]).toEqual([
        read,
        reasons.map((reason) => ({ field: "title", reason, data: {} })),
      ]);
    },
  );

  it.each([
    ["not_authenticated", 403, "UNAUTHENTICATED"],
    ["permission_denied", 403, "PERMISSION_DENIED"],
    ["not_found", 404, "NOT_FOUND"],
  ])("reads the staff code %s for the whole request", async (code, status, read) => {
    const failure = await refusal(status, { detail: { message: "…", code } });

    expect(failure).toMatchObject({ code: read, legacyText: null });
  });

  it.each([
    ["busy", "UNAVAILABLE", { retry_after_seconds: 60 }, "busy"],
    ["unavailable", "ENGINE_DOWN", {}, "unavailable"],
  ])("reads the chat's 503 %s by its reason", async (reason, code, data, read) => {
    const failure = await refusal(503, { detail: "…", reason }, { "Retry-After": "60" });

    expect(failure).toMatchObject({ code, data, reason: read });
  });
});

describe("a lost session", () => {
  it.each([
    [
      "the coded 401",
      401,
      { error: { code: "UNAUTHENTICATED", message: "…", data: {}, fields: [], request_id: ID } },
      true,
    ],
    [
      "the old 403 with no code",
      403,
      { detail: "Authentication credentials were not provided." },
      true,
    ],
    [
      "the staff 403 that names it",
      403,
      { detail: { message: "…", code: "not_authenticated" } },
      true,
    ],
    ["a refused permission", 403, { detail: { message: "…", code: "permission_denied" } }, false],
    ["a missing page", 404, { detail: "Not found." }, false],
  ])("is %s", async (_, status, body, lost) => {
    expect(isSessionLost(await refusal(status, body))).toBe(lost);
  });

  it("is not a failure that is not the server's answer", () => {
    expect(isSessionLost(new TypeError("Failed to fetch"))).toBe(false);
  });
});
