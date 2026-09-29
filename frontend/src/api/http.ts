/**
 * The plain-JSON half of the API, and the CSRF token every write needs.
 *
 * `client.ts` handles the one streaming call; everything else — who am I, log
 * in, list conversations — is an ordinary request and goes through here.
 *
 * The token is read from the cookie `GET /api/auth/me` issues and sent back as
 * `X-CSRFToken`, which is the header DRF's `CSRF_HEADER_NAME` names by default.
 * Django compares the two, so sending the header with an empty value is worse
 * than omitting it: an empty string is a mismatch rather than an absence.
 */

const JSON_TYPE = "application/json";

/**
 * A request that came back with a status, the server's own words for it, and
 * the codes a page translates it by when the view gives codes
 * (config/exceptions.py: the staff endpoints do; every endpoint doing so is
 * #91's).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Field name -> messages, when the server rejected specific fields. */
    readonly fields: Record<string, string[]> = {},
    /** The code of `detail`, or null when the server gave none. */
    readonly code: string | null = null,
    /** Field name -> codes, in the order of `fields`. */
    readonly fieldCodes: Record<string, string[]> = {},
  ) {
    super(detail);
    this.name = "ApiError";
  }

  /**
   * Whether this is the server saying "not you".
   *
   * 403 rather than 401 because only `SessionAuthentication` is configured and
   * DRF has no `WWW-Authenticate` header to offer — see apps/accounts/views.py.
   * It also covers a rejected CSRF token, which is why `GET /api/auth/me`
   * answers 200 to a stranger: that endpoint, not this code, is what says
   * whether anybody is signed in.
   */
  get isRefused(): boolean {
    return this.status === 403;
  }
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

/** One message of an error body, with its code when the view gives one. */
interface Leaf {
  message: string;
  code: string | null;
}

function leafOf(item: unknown): Leaf | null {
  if (typeof item === "string") return { message: item, code: null };
  if (typeof item !== "object" || item === null) return null;
  const { message, code } = item as Record<string, unknown>;
  return typeof message === "string" && typeof code === "string" ? { message, code } : null;
}

function leavesOf(value: unknown): Leaf[] {
  return (Array.isArray(value) ? value : [value]).flatMap((item) => leafOf(item) ?? []);
}

/**
 * DRF speaks two error shapes and both matter here.
 *
 * A permission or throttle failure is `{"detail": ...}`; a serializer
 * rejection is `{"field": [...], ...}`, which is what a form has to show next
 * to the field that was wrong. Each message is a string, or, from a view that
 * gives codes, `{"message", "code"}` — the shape of DRF's `get_full_details()`.
 */
async function failureOf(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the status code is all there is to report.
  }
  if (typeof body !== "object" || body === null) {
    return new ApiError(response.status, `HTTP ${response.status}`);
  }

  const record = body as Record<string, unknown>;
  const fields: Record<string, string[]> = {};
  const fieldCodes: Record<string, string[]> = {};
  let firstOfAField: Leaf | undefined;
  for (const [key, value] of Object.entries(record)) {
    if (key === "detail") continue;
    const leaves = leavesOf(value);
    if (leaves.length === 0) continue;
    firstOfAField ??= leaves[0];
    fields[key] = leaves.map((leaf) => leaf.message);
    const codes = leaves.flatMap((leaf) => leaf.code ?? []);
    if (codes.length > 0) fieldCodes[key] = codes;
  }

  // `detail` and `code` name the same message: the whole request's, or else
  // the first field's.
  const lead = leavesOf(record.detail)[0] ?? firstOfAField;
  return new ApiError(
    response.status,
    lead?.message ?? `HTTP ${response.status}`,
    fields,
    lead?.code ?? null,
    fieldCodes,
  );
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
