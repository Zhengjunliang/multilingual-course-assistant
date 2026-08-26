/**
 * The one call this client makes, and the failures it can come back with.
 *
 * Everything up to the first event can still be a status code; after it, a
 * failure travels inside the stream as an `error` event. That split is the
 * server's (`apps/qa/views.py`), and it is why `ask` returns a body to read
 * rather than an answer.
 */

const ASK_URL = "/api/ask";

/** A failure that arrived before the stream did, with the server's own words. */
export class AskFailed extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Seconds the server asked us to wait, when it said so. */
    readonly retryAfter: number | null,
  ) {
    super(detail);
    this.name = "AskFailed";
  }
}

export interface AskBody {
  question: string;
  /** Omitted means "decide for me" — the engine detects it from the question. */
  locale?: string;
}

/**
 * Django's CSRF token, from the cookie it was delivered in.
 *
 * Null until something has issued one — `GET /api/auth/me` is what the SPA
 * calls for that, and logging in through the proxied `/admin/` sets it too.
 * Sending the header without a value would be worse than omitting it: Django
 * compares the header against the cookie, so an empty one is a mismatch rather
 * than an absence.
 */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  const value = match?.[1];
  return value === undefined ? null : decodeURIComponent(value);
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds : null;
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "detail" in body) {
      const { detail } = body as { detail: unknown };
      if (typeof detail === "string") return detail;
    }
  } catch {
    // A body that is not JSON tells us nothing the status code does not.
  }
  return `HTTP ${response.status}`;
}

/**
 * Ask, and hand back the body to read events from.
 *
 * `signal` is not optional by accident: abandoning a stream without aborting it
 * leaves the server generating for nobody and holding its one engine slot.
 */
export async function ask(body: AskBody, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const token = csrfToken();
  if (token !== null) headers["X-CSRFToken"] = token;

  const response = await fetch(ASK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) {
    throw new AskFailed(response.status, await detailOf(response), retryAfterSeconds(response));
  }
  if (response.body === null) {
    throw new AskFailed(response.status, "The response carried no body.", null);
  }
  return response.body;
}
