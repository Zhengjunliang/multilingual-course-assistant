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

// What each one does read is the dialogs' (dialogs.test.tsx): here, what each
// must not take for its own.
describe("a staff refusal", () => {
  it("does not take a conversation gone for a staff object gone", async () => {
    expect(isNotFound(await refused("CONVERSATION_GONE"))).toBe(false);
  });

  it("does not take the session ended for a refused permission", async () => {
    expect(isForbidden(await refused("UNAUTHENTICATED"))).toBe(false);
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
