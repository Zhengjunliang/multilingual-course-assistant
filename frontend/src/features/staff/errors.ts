/**
 * What a staff page tells apart in a refusal, by its code (api/errors.ts): the
 * object gone, a permission the page offered but the caller lacks, a role
 * held already. What a refusal says is `describeError`'s (lib/errorText.ts).
 */

import type { MemberScope, Permission } from "@/api/catalog";
import { ApiError } from "@/api/http";

/**
 * Whether the user named holds the role already. No field is wrong, but a
 * name is what the reader changes, so the dialog says it at the name.
 */
export function isHeldAlready(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ROLE_ALREADY_HELD";
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "NOT_FOUND";
}

/**
 * Whether the caller sees the scope but lacks the permission the write needs,
 * a 403 the page offered the action for: its permissions were read before a
 * role changed. Not a lost session.
 */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PERMISSION_DENIED";
}

/** The permission adding or removing a member of `scope` needs (apps/roles/registry.py). */
export function grantPermission(scope: MemberScope): Permission {
  return scope.kind === "edition" ? "edition.assign_teacher" : "programme.assign_secretariat";
}
