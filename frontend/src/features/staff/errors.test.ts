/**
 * What a staff page tells apart in a refusal, read by its code from either
 * body the server may send: the coded `{"error": ...}`, and the staff
 * endpoints' `{"message", "code"}` from before it.
 */

import { describe, expect, it } from "vitest";

import { failureOf } from "@/api/http";
import { isForbidden, isHeldAlready, isNotFound } from "./errors";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

function answered(status: number, body: unknown) {
  return failureOf(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function coded(status: number, code: string) {
  return answered(status, { error: { code, message: "…", data: {}, fields: [], request_id: ID } });
}

describe("a staff refusal", () => {
  it.each([
    ["coded", () => coded(409, "ROLE_ALREADY_HELD")],
    [
      "old",
      () => answered(400, { username: [{ message: "Already held.", code: "already_held" }] }),
    ],
  ])("reads a role held already from the %s body", async (_, refusal) => {
    expect(isHeldAlready(await refusal())).toBe(true);
  });

  it.each([
    ["coded", () => coded(404, "NOT_FOUND")],
    ["old", () => answered(404, { detail: { message: "Not found.", code: "not_found" } })],
  ])("reads the object gone from the %s body", async (_, refusal) => {
    expect(isNotFound(await refusal())).toBe(true);
  });

  it("does not take a conversation gone for a staff object gone", async () => {
    expect(isNotFound(await coded(404, "CONVERSATION_GONE"))).toBe(false);
  });

  it.each([
    ["a refused permission, coded", () => coded(403, "PERMISSION_DENIED"), true],
    [
      "a refused permission, old",
      () => answered(403, { detail: { message: "No permission.", code: "permission_denied" } }),
      true,
    ],
    ["the session ended, coded", () => coded(401, "UNAUTHENTICATED"), false],
    [
      "the session ended, old",
      () => answered(403, { detail: "Authentication credentials were not provided." }),
      false,
    ],
  ])("offers the permission's own notice only for %s", async (_, refusal, forbidden) => {
    expect(isForbidden(await refusal())).toBe(forbidden);
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
