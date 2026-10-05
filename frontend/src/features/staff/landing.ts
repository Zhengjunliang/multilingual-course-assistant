/**
 * What the chat sidebar's "Gestione" group offers, and where `/staff` lands.
 *
 * Read from the account's superuser flag and from the programmes the caller
 * may view — a list the server already narrows to the caller's scope — never
 * from a role name. The superuser, and whoever views two programmes or more,
 * get the list of programmes; whoever views exactly one goes straight to it,
 * since a list of one is a page with nothing to choose. That is the
 * prototype's shape (its secretariat opens on its programme), carried over to
 * staff of several programmes.
 *
 * `programmes` is `null` until the list arrives: the superuser's item does not
 * wait for it, and nobody else's can be known before it.
 */

import type { Account } from "@/api/account";
import type { Programme } from "@/api/catalog";

export type ManagementKey = "programmes" | "programme";

export interface ManagementItem {
  key: ManagementKey;
  to: string;
  /** The paths below which the reader is inside this item, for its highlight. */
  within: readonly string[];
}

const LIST = "/staff/programmes";

export function managementItems(
  account: Account,
  programmes: readonly Programme[] | null,
): ManagementItem[] {
  const below = ["/staff/courses", "/staff/editions"];
  if (account.is_superuser || (programmes !== null && programmes.length > 1)) {
    return [{ key: "programmes", to: LIST, within: [LIST, ...below] }];
  }
  const only = programmes?.length === 1 ? programmes[0] : undefined;
  if (only !== undefined) {
    const to = `${LIST}/${encodeURIComponent(only.code)}`;
    return [{ key: "programme", to, within: [to, ...below] }];
  }
  return [];
}

/** Where `/staff` sends the account: its first Gestione item, or nowhere when it has none. */
export function landing(account: Account, programmes: readonly Programme[] | null): string | null {
  return managementItems(account, programmes)[0]?.to ?? null;
}
