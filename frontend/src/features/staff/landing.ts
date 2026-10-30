/**
 * What the chat sidebar's "Gestione" group offers, and where `/staff` lands.
 *
 * Read from the account's superuser flag, from the programmes the caller may
 * view — a list the server already narrows to the caller's scope — and from
 * whether the account teaches an edition (auth/staff.ts); what a page offers
 * to do is each row's `permissions`, not this. The superuser, and whoever views two programmes or more,
 * get the list of programmes; whoever views exactly one goes straight to it,
 * since a list of one is a page with nothing to choose. That is the
 * prototype's shape (its secretariat opens on its programme), carried over to
 * staff of several programmes (docs/decisions.md, 2026-10-05, *The staff
 * pages live in the chat shell*, point 1). A teacher also gets their own courses, after
 * any programme item, so an account that runs a programme lands on it; the
 * superuser gets the accounts and then the students' ratings of the answers
 * last, the two items no programme leads to.
 * An edition's page counts as inside the programme item when there is one,
 * and inside the teacher's own courses otherwise.
 *
 * `programmes` is `null` until the list arrives: the superuser's item does not
 * wait for it, and nobody else's can be known before it.
 */

import type { Account } from "@/api/account";
import type { Programme } from "@/api/catalog";
import { teaches } from "@/auth/staff";

export type ManagementKey = "programmes" | "programme" | "mine" | "users" | "feedback";

export interface ManagementItem {
  key: ManagementKey;
  to: string;
  /** The paths below which the reader is inside this item, for its highlight. */
  within: readonly string[];
  /**
   * What the item's page lists, as its `Count` shows it: the programmes, the
   * one programme's courses, or the editions the account teaches. `null` while
   * the superuser's list has not arrived, and for the accounts and the
   * ratings, which only their own pages count.
   */
  count: number | null;
}

const LIST = "/staff/programmes";
const MINE = "/staff/mine";
const USERS = "/staff/users";
const FEEDBACK = "/staff/feedback";

export function managementItems(
  account: Account,
  programmes: readonly Programme[] | null,
): ManagementItem[] {
  // Before the list, a teacher who also runs a programme would land on their
  // own courses rather than on the programme: no item but the superuser's yet.
  if (programmes === null && !account.is_superuser) return [];
  const below = ["/staff/courses", "/staff/editions"];
  const items: ManagementItem[] = [];
  const only = programmes?.length === 1 ? programmes[0] : undefined;
  if (account.is_superuser || (programmes !== null && programmes.length > 1)) {
    items.push({
      key: "programmes",
      to: LIST,
      within: [LIST, ...below],
      count: programmes?.length ?? null,
    });
  } else if (only !== undefined) {
    const to = `${LIST}/${encodeURIComponent(only.code)}`;
    items.push({ key: "programme", to, within: [to, ...below], count: only.course_count });
  }
  if (teaches(account)) {
    const editions = items.length === 0 ? ["/staff/editions"] : [];
    // One role per edition, as the server sends them; a Set all the same, so
    // the count is of editions and not of rows.
    const taught = new Set(
      account.roles.flatMap((scope) => (scope.role === "teacher" ? [scope.edition] : [])),
    );
    items.push({ key: "mine", to: MINE, within: [MINE, ...editions], count: taught.size });
  }
  if (account.is_superuser) {
    items.push({ key: "users", to: USERS, within: [USERS], count: null });
    items.push({ key: "feedback", to: FEEDBACK, within: [FEEDBACK], count: null });
  }
  return items;
}

/** Where `/staff` sends the account: its first Gestione item, or nowhere when it has none. */
export function landing(account: Account, programmes: readonly Programme[] | null): string | null {
  return managementItems(account, programmes)[0]?.to ?? null;
}
