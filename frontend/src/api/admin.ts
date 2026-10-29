/**
 * `/api/admin/` — the accounts, as a superuser manages them from the site
 * (apps/accounts/manage_views.py).
 *
 * The shapes mirror apps/accounts/manage_serializers.py, which is the single
 * source; tests/test_admin_contract.py fails when a field is added or renamed
 * on one side only, or when the page size differs from the server's. An
 * action is a `POST` to a path of its own under the account, and deleting is
 * the account's `DELETE`; each answers 204, a reset link 201 with its token,
 * or 404 for an account gone, or 409 for a rule it breaks
 * (apps/accounts/services.py).
 */

import type { RoleScope } from "./account";
import { request } from "./http";

/** A row of the account list: who it is, whether it may sign in, and where it holds a role. */
export interface ManagedUser {
  id: number;
  username: string;
  is_active: boolean;
  is_superuser: boolean;
  /** `null` for an account that never signed in. */
  last_login: string | null;
  date_joined: string;
  roles: RoleScope[];
}

/** A reset link just made: the one time its token is shown. */
export interface ResetLink {
  token: string;
  expires_at: string;
}

/** A page of a list, as DRF's `PageNumberPagination` answers it. */
export interface ListPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** The rows of a page of accounts: the server's `UserPagination.page_size`. */
export const USER_PAGE_SIZE = 50;

export interface UserQuery {
  /** A part of the username; empty for every account. */
  q: string;
  /** Only the active accounts, or only the deactivated; `null` for both. */
  active: boolean | null;
  /** From 1. */
  page: number;
}

const USERS = "/api/admin/users";

/** One page of the accounts, by username. */
export function listUsers({ q, active, page }: UserQuery): Promise<ListPage<ManagedUser>> {
  const query = new URLSearchParams();
  if (q !== "") query.set("q", q);
  if (active !== null) query.set("active", String(active));
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return request<ListPage<ManagedUser>>(search === "" ? USERS : `${USERS}?${search}`);
}

/** Ends every session of the account, which can no longer sign in. */
export function deactivateUser(id: number): Promise<void> {
  return request<void>(`${USERS}/${id}/deactivate`, { method: "POST" });
}

export function activateUser(id: number): Promise<void> {
  return request<void>(`${USERS}/${id}/activate`, { method: "POST" });
}

/** Ends every session of the account, which stays active. */
export function endUserSessions(id: number): Promise<void> {
  return request<void>(`${USERS}/${id}/sessions/end`, { method: "POST" });
}

/** Deletes a deactivated account, its conversations with it. */
export function deleteUser(id: number): Promise<void> {
  return request<void>(`${USERS}/${id}`, { method: "DELETE" });
}

/** A link that sets the account's password once, voiding any made before it. */
export function makeResetLink(id: number): Promise<ResetLink> {
  return request<ResetLink>(`${USERS}/${id}/reset-link`, { method: "POST" });
}
