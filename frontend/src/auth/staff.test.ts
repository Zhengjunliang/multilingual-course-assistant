/** The role the account row names, when an account holds several. */

import { describe, expect, it } from "vitest";

import type { Account, RoleScope } from "@/api/account";
import { type RoleLabel, roleOf } from "./staff";

function account(roles: RoleScope[], superuser = false): Account {
  return { id: 1, username: "reader", locale: "it", is_superuser: superuser, roles };
}

const TEACHER: RoleScope = { role: "teacher", edition: 3 };
const SECRETARIAT: RoleScope = { role: "secretariat", programme: "B047" };

describe("the account's role", () => {
  it.each<[string, Account, RoleLabel]>([
    ["no role at all", account([]), "student"],
    ["an edition taught", account([TEACHER]), "teacher"],
    ["a programme run and an edition taught", account([TEACHER, SECRETARIAT]), "secretariat"],
    ["the superuser, whatever else it holds", account([SECRETARIAT], true), "admin"],
  ])("is the widest one held: %s", (_, reader, label) => {
    expect(roleOf(reader)).toBe(label);
  });
});
