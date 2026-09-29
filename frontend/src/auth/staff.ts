import type { Account } from "@/api/account";

/**
 * Whether the account may open the staff area: the superuser, or anyone holding
 * a role somewhere. The one place the SPA decides it; what the account may do
 * inside is read from each row's `permissions`, never from a role name.
 */
export function isStaff(account: Account): boolean {
  return account.is_superuser || account.roles.length > 0;
}
