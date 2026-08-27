/**
 * The one streaming call, and the failures it can come back with.
 *
 * Everything up to the first event can still be a status code; after it, a
 * failure travels inside the stream as an `error` event. That split is the
 * server's (`apps/qa/views.py`), and it is why `ask` returns a body to read
 * rather than an answer.
 *
 * It does not go through `request()` because nothing about it is JSON in the
 * response direction — what comes back is a body to read frame by frame — but
 * it sends the same CSRF header, from the same helper.
 */

import { writeHeaders } from "./http";

const ASK_URL = "/api/ask";

/** Why a 503 happened, and therefore whether asking again could ever help. */
export type Unavailability = "busy" | "unavailable";

/** A failure that arrived before the stream did, with the server's own words. */
export class AskFailed extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Seconds the server asked us to wait, when it said so. */
    readonly retryAfter: number | null,
    /**
     * Present only on a 503. `busy` is a queue that clears on its own;
     * `unavailable` is a model server that is not running and will not start
     * because we asked again — the difference between a retry and a wait for a
     * person to fix something.
     */
    readonly reason: Unavailability | null = null,
  ) {
    super(detail);
    this.name = "AskFailed";
  }

  get isRefused(): boolean {
    return this.status === 403;
  }
}

export interface AskBody {
  question: string;
  /** Omitted starts a new conversation; the id comes back in the `start` event. */
  conversation_id?: number | null;
  /** Omitted means "decide for me" — the engine detects it from the question. */
  locale?: string;
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds : null;
}

function isUnavailability(value: unknown): value is Unavailability {
  return value === "busy" || value === "unavailable";
}

async function failureOf(response: Response): Promise<AskFailed> {
  const retryAfter = retryAfterSeconds(response);
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { detail, reason } = body as { detail?: unknown; reason?: unknown };
      return new AskFailed(
        response.status,
        typeof detail === "string" ? detail : `HTTP ${response.status}`,
        retryAfter,
        isUnavailability(reason) ? reason : null,
      );
    }
  } catch {
    // A body that is not JSON tells us nothing the status code does not.
  }
  return new AskFailed(response.status, `HTTP ${response.status}`, retryAfter);
}

/**
 * Ask, and hand back the body to read events from.
 *
 * `signal` is not optional by accident: abandoning a stream without aborting it
 * leaves the server generating for nobody and holding its one engine slot.
 */
export async function ask(body: AskBody, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(ASK_URL, {
    method: "POST",
    headers: { ...writeHeaders(), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) throw await failureOf(response);
  if (response.body === null) {
    throw new AskFailed(response.status, "The response carried no body.", null);
  }
  return response.body;
}

/**
 * "The server said not you", for either error class.
 *
 * Duck-typed rather than two `instanceof` checks: `AskFailed` and `ApiError`
 * answer the same question and every caller wants the same thing from it — send
 * this reader back to the login page.
 */
export function isRefusal(error: unknown): boolean {
  return (error as { isRefused?: boolean } | null)?.isRefused === true;
}
