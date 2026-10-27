/**
 * A staff refusal, read into the sentence a page shows by its code, and the one
 * refusal that means the caller lacks the permission the page offered.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/http";
import i18n from "@/i18n";
import { ERROR_KEYS, errorKey, fieldErrorKey, isForbidden } from "./errors";

describe("a staff refusal", () => {
  it.each([
    [
      "a code a staff page has words for",
      new ApiError({ status: 409, code: "ROLE_ALREADY_HELD" }),
      "staff.error.already_held",
    ],
    ["another of them", new ApiError({ status: 404, code: "NOT_FOUND" }), "staff.error.not_found"],
    [
      "a code the pages have no words for",
      new ApiError({ status: 405, code: "METHOD_NOT_ALLOWED" }),
      "staff.error.unknown",
    ],
    [
      "an answer that is not the API's",
      new ApiError({ status: 502, code: "BAD_RESPONSE" }),
      "staff.error.unknown",
    ],
    ["not an answer of the server", new TypeError("offline"), "staff.error.unknown"],
  ])("reads %s", (_, error, key) => {
    expect(errorKey(error)).toBe(key);
  });

  it("reads a field's refusal, and nothing for a field that was not refused", () => {
    const error = new ApiError({
      status: 400,
      code: "INVALID_ARGUMENT",
      violations: [{ field: "username", reason: "NO_SUCH_USER", data: {} }],
    });

    expect([fieldErrorKey(error, "username"), fieldErrorKey(error, "role")]).toEqual([
      "staff.error.no_such_user",
      null,
    ]);
  });

  it.each([
    ["a refused permission", new ApiError({ status: 403, code: "PERMISSION_DENIED" }), true],
    ["the session ended", new ApiError({ status: 401, code: "UNAUTHENTICATED" }), false],
  ])("offers the permission's own notice only for %s", (_, error, forbidden) => {
    expect(isForbidden(error)).toBe(forbidden);
  });

  it("has words for every code in every catalogue", () => {
    const missing = ["it", "en", "zh-hans"].flatMap((lng) =>
      ERROR_KEYS.filter((key) => !i18n.exists(key, { lng })).map((key) => `${lng}: ${key}`),
    );

    expect(missing).toEqual([]);
  });
});
