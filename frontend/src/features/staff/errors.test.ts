/**
 * A staff refusal, read into the sentence a page shows, and the one refusal
 * that means the session is gone.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/http";
import i18n from "@/i18n";
import { ERROR_KEYS, errorKey, fieldErrorKey, isSessionLost } from "./errors";

describe("a staff refusal", () => {
  it.each([
    [
      "a code of the contract",
      new ApiError(403, "…", {}, "switch_needs_both"),
      "staff.error.switch_needs_both",
    ],
    [
      "a code of DRF's the pages name",
      new ApiError(404, "…", {}, "not_found"),
      "staff.error.not_found",
    ],
    [
      "a code the pages have no words for",
      new ApiError(405, "…", {}, "method_not_allowed"),
      "staff.error.unknown",
    ],
    ["no code at all", new ApiError(502, "HTTP 502"), "staff.error.unknown"],
    ["not an answer of the server", new TypeError("offline"), "staff.error.unknown"],
  ])("reads %s", (_, error, key) => {
    expect(errorKey(error)).toBe(key);
  });

  it("reads a field's refusal, and nothing for a field that was not refused", () => {
    const error = new ApiError(400, "…", { username: ["…"] }, "no_such_user", {
      username: ["no_such_user"],
    });

    expect([fieldErrorKey(error, "username"), fieldErrorKey(error, "role")]).toEqual([
      "staff.error.no_such_user",
      null,
    ]);
  });

  it.each([
    ["the session ended", new ApiError(403, "…", {}, "not_authenticated"), true],
    ["a refused permission", new ApiError(403, "…", {}, "permission_denied"), false],
    ["a 403 with no code", new ApiError(403, "CSRF Failed"), false],
  ])("sends the reader to sign in only when %s", (_, error, lost) => {
    expect(isSessionLost(error)).toBe(lost);
  });

  it("has words for every code in every catalogue", () => {
    const missing = ["it", "en", "zh-hans"].flatMap((lng) =>
      ERROR_KEYS.filter((key) => !i18n.exists(key, { lng })).map((key) => `${lng}: ${key}`),
    );

    expect(missing).toEqual([]);
  });
});
