/**
 * What a staff page tells apart in a refusal, read by its code from the coded
 * body (#186).
 */

import { describe, expect, it } from "vitest";

import type { ErrorCode } from "@/api/errors";
import { failureOf } from "@/api/http";
import { codedRefusal } from "@/test/refusal";
import { isForbidden, isHeldAlready, isNotFound } from "./errors";

function refused(code: ErrorCode) {
  return failureOf(codedRefusal(code));
}

describe("a staff refusal", () => {
  it("reads a role held already", async () => {
    expect(isHeldAlready(await refused("ROLE_ALREADY_HELD"))).toBe(true);
  });

  it("reads the object gone", async () => {
    expect(isNotFound(await refused("NOT_FOUND"))).toBe(true);
  });

  it("does not take a conversation gone for a staff object gone", async () => {
    expect(isNotFound(await refused("CONVERSATION_GONE"))).toBe(false);
  });

  it.each([
    ["a refused permission", "PERMISSION_DENIED", true],
    ["the session ended", "UNAUTHENTICATED", false],
  ] as const)("offers the permission's own notice only for %s", async (_, code, forbidden) => {
    expect(isForbidden(await refused(code))).toBe(forbidden);
  });

  it("reads none of them from what is not an answer of the server", () => {
    const offline = new TypeError("offline");

    expect([isHeldAlready(offline), isNotFound(offline), isForbidden(offline)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
