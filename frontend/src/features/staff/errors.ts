/**
 * A staff endpoint's refusal, turned into the catalogue key of its sentence.
 *
 * The page reads a refusal by its code (api/errors.ts) and has words for the
 * codes a staff page meets; any other code reads as one general sentence.
 */

import type { MemberScope, Permission } from "@/api/catalog";
import type { FieldReason } from "@/api/errors";
import { type ApiCode, ApiError } from "@/api/http";

const SENTENCE: Partial<Record<ApiCode, string>> = {
  ROLE_ALREADY_HELD: "staff.error.already_held",
  UNAUTHENTICATED: "staff.error.not_authenticated",
  PERMISSION_DENIED: "staff.error.permission_denied",
  NOT_FOUND: "staff.error.not_found",
};

const FIELD_SENTENCE: Partial<Record<FieldReason, string>> = {
  REQUIRED: "staff.error.required",
  INVALID: "staff.error.invalid",
  TOO_LONG: "staff.error.max_length",
  TOO_SMALL: "staff.error.min_value",
  TOO_LARGE: "staff.error.max_value",
  ALREADY_EXISTS: "staff.error.unique",
  NO_SUCH_USER: "staff.error.no_such_user",
};

export const UNKNOWN = "staff.error.unknown";

/** Every key a refusal can be shown with. */
export const ERROR_KEYS: readonly string[] = [
  ...Object.values(SENTENCE),
  ...Object.values(FIELD_SENTENCE),
  UNKNOWN,
];

/** The sentence for a refusal of the whole request. */
export function errorKey(error: unknown): string {
  return (error instanceof ApiError ? SENTENCE[error.code] : undefined) ?? UNKNOWN;
}

/** The sentence for a refusal of one field, or null when that field was not refused. */
export function fieldErrorKey(error: unknown, field: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const violation = error.violations.find((each) => each.field === field);
  return violation === undefined ? null : (FIELD_SENTENCE[violation.reason] ?? UNKNOWN);
}

/**
 * Whether the user named holds the role already. No field is wrong, but a
 * name is what the reader changes, so the dialog says it at the name.
 */
export function isHeldAlready(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ROLE_ALREADY_HELD";
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
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
