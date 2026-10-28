/**
 * The API's error codes and error body, mirrored.
 *
 * The single source is `config/errors.py`; this file is its shadow on the
 * client. A page reads an error by its code, never by the server's English
 * `message`, and finds the sentence for it in its own catalogue (#186).
 * `tests/test_error_contract.py` reads this file as plain text and holds
 * `ERROR_CODES` equal to `SPEC`, `FIELD_REASONS` equal to `FIELD_SPEC`, and the
 * body's field names equal to the pydantic models'. `LOCAL_CODES` and
 * `FIELD_OVERRIDES` are the client's alone; `src/i18n/errors.test.ts` holds
 * every catalogue to a sentence for each code, reason and override here.
 */

/**
 * `fixable`: the reader can act on the error, and the page gives its sentence
 * alone. `failure`: they cannot, and the page adds the code and the request id,
 * for a report.
 */
type ErrorKind = "fixable" | "failure";

/** Each code with its HTTP status, its kind and the values its sentence fills in. */
export const ERROR_CODES = {
  INVALID_ARGUMENT: { status: 400, kind: "fixable", dataKeys: [] },
  MALFORMED_REQUEST: { status: 400, kind: "failure", dataKeys: [] },
  WRONG_CREDENTIALS: { status: 400, kind: "fixable", dataKeys: [] },
  UNAUTHENTICATED: { status: 401, kind: "fixable", dataKeys: [] },
  PERMISSION_DENIED: { status: 403, kind: "fixable", dataKeys: [] },
  CSRF_FAILED: { status: 403, kind: "failure", dataKeys: [] },
  NOT_FOUND: { status: 404, kind: "fixable", dataKeys: [] },
  CONVERSATION_GONE: { status: 404, kind: "fixable", dataKeys: [] },
  LINK_EXPIRED: { status: 404, kind: "fixable", dataKeys: [] },
  METHOD_NOT_ALLOWED: { status: 405, kind: "failure", dataKeys: [] },
  NOT_ACCEPTABLE: { status: 406, kind: "failure", dataKeys: [] },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, kind: "failure", dataKeys: [] },
  ROLE_ALREADY_HELD: { status: 409, kind: "fixable", dataKeys: [] },
  SELF_NOT_ALLOWED: { status: 409, kind: "fixable", dataKeys: [] },
  ACCOUNT_STILL_ACTIVE: { status: 409, kind: "fixable", dataKeys: [] },
  ROLES_HELD: { status: 409, kind: "fixable", dataKeys: [] },
  LAST_SUPERUSER: { status: 409, kind: "fixable", dataKeys: [] },
  RESOURCE_EXHAUSTED: { status: 429, kind: "fixable", dataKeys: ["retry_after_seconds"] },
  UNAVAILABLE: { status: 503, kind: "fixable", dataKeys: ["retry_after_seconds"] },
  ENGINE_DOWN: { status: 503, kind: "failure", dataKeys: [] },
  INTERNAL: { status: 500, kind: "failure", dataKeys: [] },
} as const satisfies Record<
  string,
  { status: number; kind: ErrorKind; dataKeys: readonly string[] }
>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Why one field was rejected, with the values its sentence fills in. */
export const FIELD_REASONS = {
  REQUIRED: { dataKeys: [] },
  INVALID: { dataKeys: [] },
  TOO_LONG: { dataKeys: ["max_length"] },
  TOO_SHORT: { dataKeys: ["min_length"] },
  TOO_SMALL: { dataKeys: ["min_value"] },
  TOO_LARGE: { dataKeys: ["max_value"] },
  ALREADY_EXISTS: { dataKeys: [] },
  NO_SUCH_USER: { dataKeys: [] },
  TOO_COMMON: { dataKeys: [] },
  BREACHED: { dataKeys: [] },
  TOO_SIMILAR: { dataKeys: [] },
} as const satisfies Record<string, { dataKeys: readonly string[] }>;

export type FieldReason = keyof typeof FIELD_REASONS;

/**
 * The client's own codes, for a failure no server named: no answer at all, an
 * answer that is not this API's body, and an answer stream that stopped before
 * its end. Each is a `failure`, and carries no data.
 */
export const LOCAL_CODES = ["NETWORK", "BAD_RESPONSE", "STREAM_INTERRUPTED"] as const;

export type LocalCode = (typeof LOCAL_CODES)[number];

/**
 * The fields whose reasons read better in words of their own, under
 * `errors.field.<field>.<REASON>`: "This username is taken" rather than "This
 * already exists". Any other field takes the reason's general sentence.
 */
export const FIELD_OVERRIDES = {
  username: ["INVALID", "ALREADY_EXISTS"],
  title: ["ALREADY_EXISTS"],
} as const satisfies Record<string, readonly FieldReason[]>;

/** Numbers stay numbers, for the page to format in its own language. */
export type ErrorData = Record<string, number | string>;

/** One rejected field: its path, dots between names and indexes (`items.0.title`). */
export interface FieldViolation {
  /** `null` for an error of the object as a whole. */
  field: string | null;
  reason: FieldReason;
  data: ErrorData;
}

/** What `"error"` holds in every error body. */
export interface ErrorBody {
  code: ErrorCode;
  /** English, for the developer and the log; no page shows it. */
  message: string;
  data: ErrorData;
  fields: FieldViolation[];
  /** 32 hex characters, also in the response's `X-Request-ID` and on the server's log lines. */
  request_id: string;
}
