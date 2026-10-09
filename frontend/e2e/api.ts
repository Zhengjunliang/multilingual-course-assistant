/**
 * The API, answered in the browser.
 *
 * Every `/api` request the page makes is caught by `page.route` and answered
 * from the fixtures below, which are typed by the client's own mirrors of the
 * server's shapes (`src/api/*.ts`). Those mirrors are held to the Python side by
 * `tests/test_qa_contract.py` and `tests/test_catalog_contract.py`, so a field
 * renamed on the server breaks `tsc` here before it can break a test silently.
 *
 * A request no fixture answers gets a 501 and fails the test when it ends: a
 * page that starts calling a new endpoint must say what it expects back.
 */

import { test as base, expect, type Page, type Request } from "@playwright/test";

import type { Account, Session } from "@/api/account";
import type { AskBody } from "@/api/client";
import type { AnswerEvent, Citation, RouteDecision } from "@/api/contract";
import type { ConversationSummary } from "@/api/conversations";

type Reply = { status?: number; json?: unknown; sse?: AnswerEvent[] };
type Handler = (request: Request) => Reply;

/** The SSE framing `apps/qa/contract.py` writes and `src/api/sse.ts` reads. */
function frames(events: AnswerEvent[]): string {
  return events
    .map(({ name, data }) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

export class Api {
  /** `METHOD /path` of every request no fixture answered. */
  readonly unanswered: string[] = [];
  /** The body of every question asked, in order. */
  readonly asked: AskBody[] = [];
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly page: Page) {
    this.on("GET", "/api/auth/me", () => ({ json: VISITOR }));
  }

  async install(): Promise<void> {
    await this.page.route("**/api/**", async (route) => {
      const request = route.request();
      const key = `${request.method()} ${new URL(request.url()).pathname}`;
      const handler = this.handlers.get(key);
      if (handler === undefined) {
        this.unanswered.push(key);
        await route.fulfill({ status: 501, json: { detail: `No fixture for ${key}` } });
        return;
      }
      const { status = 200, json, sse } = handler(request);
      if (sse !== undefined) {
        await route.fulfill({ status, contentType: "text/event-stream", body: frames(sse) });
      } else if (json === undefined) {
        await route.fulfill({ status });
      } else {
        await route.fulfill({ status, json });
      }
    });
  }

  on(method: string, path: string, handler: Handler): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  /** Signed in as `account`, with no stored conversations. */
  signIn(account: Account): void {
    const session: Session = { authenticated: true, user: account };
    this.on("GET", "/api/auth/me", () => ({ json: session }));
    this.on("GET", "/api/conversations", () => ({ json: [] satisfies ConversationSummary[] }));
  }

  /** Every question gets this stream, whole. */
  answer(events: AnswerEvent[]): void {
    this.on("POST", "/api/ask", (request) => {
      this.asked.push(request.postDataJSON() as AskBody);
      return { sse: events };
    });
  }
}

export const test = base.extend<{ api: Api }>({
  api: [
    async ({ page }, use) => {
      const api = new Api(page);
      await api.install();
      await use(api);
      expect(api.unanswered, "requests no fixture answered").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// --- fixtures ----------------------------------------------------------------

const VISITOR: Session = { authenticated: false, user: null };

export const STUDENT: Account = {
  id: 1,
  username: "demo-student",
  locale: "it",
  is_superuser: false,
  roles: [],
};

const CAMPUS_ROUTE: RouteDecision = {
  target: "unifi_web",
  query: "iscrizione esami",
  fresh: false,
  reason: "La domanda riguarda l'ateneo.",
};

const SLIDES_ROUTE: RouteDecision = {
  target: "slides",
  query: "chiave primaria",
  fresh: false,
  reason: "La domanda riguarda il corso.",
};

const WEB_CITATION: Citation = {
  marker: "[Excerpt 1]",
  kind: "web",
  text: "Ci si iscrive agli appelli su Sol, entro cinque giorni dalla data.",
  heading_path: ["Studenti", "Esami"],
  course: "",
  academic_year: null,
  locale: "it",
  score: 0.82,
  source_file: "",
  source_sha256: null,
  page: 0,
  url: "https://www.unifi.it/esami",
  fetch_date: "2026-09-30",
};

export const SLIDES_CITATION: Citation = {
  marker: "[Excerpt 1]",
  kind: "slides",
  text: "Una chiave primaria identifica ogni riga della tabella.",
  heading_path: ["Chiavi"],
  course: "B003",
  academic_year: "2025-2026",
  locale: "it",
  score: 0.77,
  source_file: "basi-di-dati-05.pdf",
  source_sha256: "ab".repeat(32),
  page: 12,
  url: null,
  fetch_date: null,
};

export const CAMPUS_QUESTION = "Come mi iscrivo a un esame?";
const CAMPUS_ANSWER = "Ci si iscrive su Sol, entro cinque giorni dall'appello.";
export const SLIDES_QUESTION = "Cos'è una chiave primaria?";
const SLIDES_ANSWER = "È il campo che distingue una riga da ogni altra.";

/** A whole answer: `start`, the text in two tokens, `end`. */
function stream(
  question: string,
  answer: string,
  route: RouteDecision,
  citation: Citation,
  conversation: number | null,
): AnswerEvent[] {
  const half = Math.floor(answer.length / 2);
  return [
    {
      name: "start",
      data: { question, conversation_id: conversation, locale: "it", route, citations: [citation] },
    },
    { name: "token", data: { text: answer.slice(0, half) } },
    { name: "token", data: { text: `${answer.slice(half)} ${citation.marker}` } },
    { name: "end", data: {} },
  ];
}

export const campusStream = (conversation: number | null) =>
  stream(CAMPUS_QUESTION, CAMPUS_ANSWER, CAMPUS_ROUTE, WEB_CITATION, conversation);

export const slidesStream = (conversation: number | null) =>
  stream(SLIDES_QUESTION, SLIDES_ANSWER, SLIDES_ROUTE, SLIDES_CITATION, conversation);
