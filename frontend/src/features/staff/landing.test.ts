/** What Gestione offers each kind of account, and where `/staff` sends it. */

import { describe, expect, it } from "vitest";

import type { Account, RoleScope } from "@/api/account";
import type { Programme } from "@/api/catalog";
import { landing, managementItems } from "./landing";

function account(roles: RoleScope[], superuser = false): Account {
  return { id: 1, username: "reader", locale: "it", is_superuser: superuser, roles };
}

function programme(code: string): Programme {
  return {
    code,
    name: code,
    locale: "it",
    curricula: [],
    course_count: 0,
    secretariat: [],
    permissions: ["programme.view"],
  };
}

const B047 = programme("B047");
const B222 = programme("B222");
const SECRETARIAT: RoleScope = { role: "secretariat", programme: "B047" };

describe("the Gestione group", () => {
  it.each<[string, Account, Programme[] | null, string[], string | null]>([
    ["a student", account([]), [], [], null],
    ["a teacher", account([{ role: "teacher", edition: 3 }]), [], ["mine"], "/staff/mine"],
    // Both items, and the programme first: where the account lands.
    [
      "secretariat staff who teach",
      account([SECRETARIAT, { role: "teacher", edition: 3 }]),
      [B047],
      ["programme", "mine"],
      "/staff/programmes/B047",
    ],
    [
      "one programme's secretariat",
      account([SECRETARIAT]),
      [B047],
      ["programme"],
      "/staff/programmes/B047",
    ],
    [
      "two programmes' secretariat",
      account([SECRETARIAT, { role: "secretariat", programme: "B222" }]),
      [B047, B222],
      ["programmes"],
      "/staff/programmes",
    ],
    ["the superuser", account([], true), [B047, B222], ["programmes"], "/staff/programmes"],
    // The superuser's item does not wait for the list; nobody else's can be known before it.
    [
      "the superuser, before the list",
      account([], true),
      null,
      ["programmes"],
      "/staff/programmes",
    ],
    ["secretariat, before the list", account([SECRETARIAT]), null, [], null],
    [
      "secretariat staff who teach, before the list",
      account([SECRETARIAT, { role: "teacher", edition: 3 }]),
      null,
      [],
      null,
    ],
  ])("for %s", (_, reader, programmes, keys, lands) => {
    expect(managementItems(reader, programmes).map((item) => item.key)).toEqual(keys);
    expect(landing(reader, programmes)).toBe(lands);
  });
});
