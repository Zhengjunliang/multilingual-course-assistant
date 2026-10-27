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

interface ApiErrorInit {
  status: number;
  code: ApiCode;
  data?: ErrorData;
  violations?: readonly FieldViolation[];
  requestId?: string | null;
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
  readonly violations: readonly FieldViolation[];
  /** The id of this request on the server's log lines; null when no response arrived. */
  readonly requestId: string | null;

  constructor({ status, code, data = {}, violations = [], requestId = null }: ApiErrorInit) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
    this.violations = violations;
    this.requestId = requestId;
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
function violationOf(item: unknown): FieldViolation[] {
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

/**
 * A response that was not ok, read into its `ApiError`. A body that is not
 * the coded one — an HTML page from Django or a proxy — is `BAD_RESPONSE`,
 * with the request id the response header carries.
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
  return isRecord(body) && isRecord(body.error)
    ? codedError(status, body.error, requestId)
    : new ApiError({ status, code: "BAD_RESPONSE", requestId });
}

/**
 * An `error` event inside the answer stream, read into its `ApiError`. The
 * response had begun, so the status is the stream's own 200, and the request
 * id the one its header carried.
 */
export function failureOfEvent(data: unknown, requestId: string | null): ApiError {
  return isRecord(data) && isRecord(data.error)
    ? codedError(200, data.error, requestId)
    : new ApiError({ status: 200, code: "BAD_RESPONSE", requestId });
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
