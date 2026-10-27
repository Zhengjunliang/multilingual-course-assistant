/**
 * The plain-JSON half of the API, the CSRF token every write needs, and the
 * one error a failed request becomes.
 *
 * `client.ts` handles the one streaming call; everything else — who am I, log
 * in, list conversations — is an ordinary request and goes through here. Both
 * read a refusal with `failureOf`; a failure inside the stream, once it has
 * begun, is read with `failureOfEvent`.
 *
 * The token is read from the cookie `GET /api/auth/me` issues and sent back as
 * `X-CSRFToken`, which is the header DRF's `CSRF_HEADER_NAME` names by default.
 * Django compares the two, so sending the header with an empty value is worse
 * than omitting it: an empty string is a mismatch rather than an absence.
 */

import {
  ERROR_CODES,
  type ErrorCode,
  type ErrorData,
  FIELD_REASONS,
  type FieldReason,
  type FieldViolation,
  type LocalCode,
} from "./errors";

const JSON_TYPE = "application/json";

/** A code a page has a sentence for: the server's, or the client's own. */
export type ApiCode = ErrorCode | LocalCode;

/** One refused field, as `ApiError` holds it. */
export interface Violation extends FieldViolation {
  /**
   * Transitional (#186): the server's own sentence for a field it gave no
   * code, from the body shape before `{"error": ...}`.
   */
  legacyText?: string;
}

interface ApiErrorInit {
  status: number;
  code: ApiCode;
  data?: ErrorData;
  violations?: readonly Violation[];
  requestId?: string | null;
  legacyText?: string | null;
}

/**
 * A failed request, by its code: the server's, from the closed table of
 * `api/errors.ts`, or the client's own for an answer that never came or could
 * not be read. A page shows none of the server's words; `lib/errorText.ts`
 * reads the code into a sentence of the interface's catalogue (#186).
 */
export class ApiError extends Error {
  /** The HTTP status, or 0 when no response arrived. */
  readonly status: number;
  readonly code: ApiCode;
  /** The values the code's sentence fills in, named by its `dataKeys`. */
  readonly data: ErrorData;
  /** The refused fields, beside `INVALID_ARGUMENT`. */
  readonly violations: readonly Violation[];
  /** The id of this request on the server's log lines; null when no response arrived. */
  readonly requestId: string | null;
  /**
   * Transitional (#186): the server's own sentence for the whole request, from
   * a body that gave no code.
   */
  readonly legacyText: string | null;

  constructor({
    status,
    code,
    data = {},
    violations = [],
    requestId = null,
    legacyText = null,
  }: ApiErrorInit) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
    this.violations = violations;
    this.requestId = requestId;
    this.legacyText = legacyText;
  }

  /** Transitional (#186): the server's sentence, for a page not yet reading codes. */
  get detail(): string {
    return (
      this.legacyText ??
      this.violations.find((violation) => violation.legacyText !== undefined)?.legacyText ??
      `HTTP ${this.status}`
    );
  }

  /** Transitional (#186): field name -> the server's sentences for it. */
  get fields(): Record<string, string[]> {
    const fields: Record<string, string[]> = {};
    for (const { field, legacyText } of this.violations) {
      if (legacyText === undefined) continue;
      const name = field ?? "non_field_errors";
      fields[name] = [...(fields[name] ?? []), legacyText];
    }
    return fields;
  }
}

/**
 * Whether the server said "not you": the session ended, in another tab or with
 * a restart, and the reader has to sign in again.
 */
export function isSessionLost(error: unknown): boolean {
  return error instanceof ApiError && error.code === "UNAUTHENTICATED";
}

export function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  const value = match?.[1];
  return value === undefined ? null : decodeURIComponent(value);
}

export function writeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": JSON_TYPE };
  const token = csrfToken();
  if (token !== null) headers["X-CSRFToken"] = token;
  return headers;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}

function isFieldReason(value: unknown): value is FieldReason {
  return typeof value === "string" && Object.hasOwn(FIELD_REASONS, value);
}

function dataOf(value: unknown): ErrorData {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number | string] =>
        typeof entry[1] === "number" || typeof entry[1] === "string",
    ),
  );
}

/**
 * One field of the coded body. A reason this client does not know reads as
 * `INVALID`, the server's own fallback for a code it cannot map.
 */
function violationOf(item: unknown): Violation[] {
  if (!isRecord(item)) return [];
  const { field, reason, data } = item;
  if (typeof field !== "string" && field !== null) return [];
  return isFieldReason(reason)
    ? [{ field, reason, data: dataOf(data) }]
    : [{ field, reason: "INVALID", data: {} }];
}

/**
 * The coded body, `{"error": {...}}`. A code this client does not know, from a
 * server deployed after the page was loaded, reads as `INTERNAL`: the reader
 * can do nothing about it, and the server's log line under the request id
 * names the real one.
 */
function codedError(status: number, body: Json, headerId: string | null): ApiError {
  const requestId = typeof body.request_id === "string" ? body.request_id : headerId;
  if (!isErrorCode(body.code)) return new ApiError({ status, code: "INTERNAL", requestId });
  return new ApiError({
    status,
    code: body.code,
    data: dataOf(body.data),
    violations: Array.isArray(body.fields) ? body.fields.flatMap(violationOf) : [],
    requestId,
  });
}

// Transitional (#186): the body shapes from before `{"error": ...}`, read into
// the codes they will answer with, until every endpoint does.

/**
 * The codes the staff endpoints' envelope carried, `{"message", "code"}`:
 * their own two, and the DRF ones their pages had words for.
 */
export type StaffErrorCode =
  | "no_such_user"
  | "already_held"
  | "required"
  | "blank"
  | "not_authenticated"
  | "permission_denied"
  | "not_found"
  | "max_length"
  | "invalid"
  | "invalid_choice"
  | "min_value"
  | "max_value"
  | "unique";

/**
 * Each staff code, read as a whole request's code or a field's reason.
 * `already_held` was a username field's, but the name was fine: the user
 * holds the role already, a 409 `ROLE_ALREADY_HELD` with no field in the
 * coded body.
 */
const LEGACY_CODES: Record<StaffErrorCode, { code: ErrorCode } | { reason: FieldReason }> = {
  no_such_user: { reason: "NO_SUCH_USER" },
  already_held: { code: "ROLE_ALREADY_HELD" },
  required: { reason: "REQUIRED" },
  blank: { reason: "REQUIRED" },
  not_authenticated: { code: "UNAUTHENTICATED" },
  permission_denied: { code: "PERMISSION_DENIED" },
  not_found: { code: "NOT_FOUND" },
  max_length: { reason: "TOO_LONG" },
  invalid: { reason: "INVALID" },
  invalid_choice: { reason: "INVALID" },
  min_value: { reason: "TOO_SMALL" },
  max_value: { reason: "TOO_LARGE" },
  unique: { reason: "ALREADY_EXISTS" },
};

function legacyOf(code: string | null): { code?: ErrorCode; reason?: FieldReason } {
  return code !== null && Object.hasOwn(LEGACY_CODES, code)
    ? LEGACY_CODES[code as StaffErrorCode]
    : {};
}

/**
 * A body with no code, by its status. A 403 without one is a session that
 * ended or a CSRF token refused, both of which send the reader to sign in.
 */
const LEGACY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "UNAUTHENTICATED",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  406: "NOT_ACCEPTABLE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RESOURCE_EXHAUSTED",
};

/** The chat's 503 `reason`: a queue that clears on its own, or a service that is down. */
const LEGACY_REASON_503: Partial<Record<string, ErrorCode>> = {
  busy: "UNAVAILABLE",
  unavailable: "ENGINE_DOWN",
};

/** One message of an old body: a sentence, or `{"message", "code"}` from a staff view. */
interface Leaf {
  message: string;
  code: string | null;
}

function leavesOf(value: unknown): Leaf[] {
  return (Array.isArray(value) ? value : [value]).flatMap((item): Leaf[] => {
    if (typeof item === "string") return [{ message: item, code: null }];
    if (!isRecord(item)) return [];
    const { message, code } = item;
    return typeof message === "string" && typeof code === "string" ? [{ message, code }] : [];
  });
}

/**
 * DRF's two shapes: `{"detail": ...}` for the whole request, `{"field": [...]}`
 * for a serializer's refusal (`non_field_errors` for the object as a whole);
 * a staff view gives each message its code. The chat's 503 adds `reason`.
 */
function legacyError(
  status: number,
  body: Json,
  requestId: string | null,
  retryAfter: number | null,
): ApiError {
  let lifted: ErrorCode | undefined;
  const violations: Violation[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === "detail" || key === "reason") continue;
    const field = key === "non_field_errors" ? null : key;
    for (const { message, code } of leavesOf(value)) {
      const legacy = legacyOf(code);
      lifted ??= legacy.code;
      if (legacy.code !== undefined) continue;
      violations.push(
        code === null
          ? { field, reason: "INVALID", data: {}, legacyText: message }
          : { field, reason: legacy.reason ?? "INVALID", data: {} },
      );
    }
  }

  const detail = leavesOf(body.detail)[0];
  const code =
    lifted ??
    (status === 503 && typeof body.reason === "string"
      ? LEGACY_REASON_503[body.reason]
      : undefined) ??
    legacyOf(detail?.code ?? null).code ??
    LEGACY_STATUS[status] ??
    "INTERNAL";
  const waits = (ERROR_CODES[code].dataKeys as readonly string[]).includes("retry_after_seconds");
  return new ApiError({
    status,
    code,
    data: waits && retryAfter !== null ? { retry_after_seconds: retryAfter } : {},
    violations: lifted === undefined ? violations : [],
    requestId,
    legacyText: detail?.code === null ? detail.message : null,
  });
}

/**
 * The JSON of a refusal, framed or not.
 *
 * `/api/ask` asks for `text/event-stream`, so DRF writes its error bodies as
 * one `error` event (apps/qa/views.py, `ServerSentEventRenderer`); whatever
 * answers without that framing, a proxy for one, sends the JSON as it is.
 */
function refusalJson(text: string): unknown {
  const field = "data: ";
  const data = text.startsWith("event: error")
    ? text.slice(text.indexOf(field) + field.length)
    : text;
  return JSON.parse(data);
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * A response that was not ok, read into its `ApiError`. A body that is not
 * JSON — an HTML page from Django or a proxy — is `BAD_RESPONSE`, with the
 * request id the response header carries.
 */
export async function failureOf(response: Response): Promise<ApiError> {
  const { status } = response;
  const requestId = response.headers.get("X-Request-ID");
  let body: unknown = null;
  try {
    body = refusalJson(await response.text());
  } catch {
    // Not JSON: there is no code to read.
  }
  if (!isRecord(body)) return new ApiError({ status, code: "BAD_RESPONSE", requestId });
  if (isRecord(body.error)) return codedError(status, body.error, requestId);
  return legacyError(status, body, requestId, retryAfterSeconds(response));
}

/**
 * An `error` event inside the answer stream, read into its `ApiError`. The
 * response had begun, so the status is the stream's own 200, and the request
 * id the one its header carried.
 */
export function failureOfEvent(data: unknown, requestId: string | null): ApiError {
  if (isRecord(data) && isRecord(data.error)) return codedError(200, data.error, requestId);
  // Transitional (#186): the event before `{"error": ...}`, the server's
  // sentence for the one failure it sends there.
  if (isRecord(data) && typeof data.detail === "string") {
    return new ApiError({ status: 200, code: "ENGINE_DOWN", requestId, legacyText: data.detail });
  }
  return new ApiError({ status: 200, code: "BAD_RESPONSE", requestId });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(path, {
    ...init,
    // Same-origin in both deployments: Vite proxies to Django in development
    // with `changeOrigin: false`, and Django serves the built page later.
    credentials: "same-origin",
    headers: {
      Accept: JSON_TYPE,
      ...(method === "GET" ? {} : writeHeaders()),
      ...init.headers,
    },
  });

  if (!response.ok) throw await failureOf(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
