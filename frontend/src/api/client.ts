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
  const response = await fetch(ASK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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
