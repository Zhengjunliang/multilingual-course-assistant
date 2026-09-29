/**
 * A staff endpoint's refusal, turned into the catalogue key of its sentence.
 *
 * The server names each refusal with a code (config/exceptions.py); the page
 * has words for the codes of `StaffErrorCode` and one general sentence for any
 * other, since DRF's codes are not a closed set. `SENTENCE` has a key for every
 * code of the type, so a code added to the contract fails `tsc` here until it
 * has words.
 */

import type { StaffErrorCode } from "@/api/catalog";
import { ApiError } from "@/api/http";

const SENTENCE: Record<StaffErrorCode, `staff.error.${StaffErrorCode}`> = {
  no_such_user: "staff.error.no_such_user",
  already_held: "staff.error.already_held",
  switch_needs_both: "staff.error.switch_needs_both",
  required: "staff.error.required",
  blank: "staff.error.blank",
  not_authenticated: "staff.error.not_authenticated",
  permission_denied: "staff.error.permission_denied",
  not_found: "staff.error.not_found",
};

export const UNKNOWN = "staff.error.unknown";

/** Every key a refusal can be shown with. */
export const ERROR_KEYS: readonly string[] = [...Object.values(SENTENCE), UNKNOWN];

function sentenceOf(code: string | null | undefined): string {
  return code != null && code in SENTENCE ? SENTENCE[code as StaffErrorCode] : UNKNOWN;
}

/** The sentence for a refusal of the whole request. */
export function errorKey(error: unknown): string {
  return sentenceOf(error instanceof ApiError ? error.code : null);
}

/** The sentence for a refusal of one field, or null when that field was not refused. */
export function fieldErrorKey(error: unknown, field: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const code = error.fieldCodes[field]?.[0];
  return code === undefined ? null : sentenceOf(code);
}

/**
 * Whether the session is gone. Only this 403 sends the reader to sign in; any
 * other 403 is a refusal shown where it happened. The chat keeps its own rule,
 * `ApiError.isRefused`, since its endpoints give no codes.
 */
export function isSessionLost(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "not_authenticated";
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
