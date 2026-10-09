/**
 * The API, answered in the browser.
 *
 * Every `/api` request the page makes is caught by `page.route` and answered
 * from `e2e/fixtures.ts`. A request no fixture answers gets a 501 and fails the
 * test when it ends: a page that starts calling a new endpoint must say what it
 * expects back.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { test as base, expect, type Page, type Request } from "@playwright/test";

import type { Account, Session } from "@/api/account";
import type { AskBody } from "@/api/client";
import type { AnswerEvent } from "@/api/contract";
import type { ConversationDetail, ConversationSummary } from "@/api/conversations";
import { COURSE, EDITION, PROGRAMME, STUDY_PLAN, VISITOR } from "./fixtures";

/** `sse` is a whole stream; `open` is sent and then held open, mid-answer. */
type Reply = { status?: number; json?: unknown; sse?: AnswerEvent[]; open?: AnswerEvent[] };
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
  private readonly servers: Server[] = [];

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
      const { status = 200, json, sse, open } = handler(request);
      if (open !== undefined) {
        await route.continue({ url: await this.openStream(open) });
      } else if (sse !== undefined) {
        await route.fulfill({ status, contentType: "text/event-stream", body: frames(sse) });
      } else if (json === undefined) {
        await route.fulfill({ status });
      } else {
        await route.fulfill({ status, json });
      }
    });
  }

  /**
   * A local server that sends `events` and never ends the response.
   *
   * `route.fulfill` can only send a whole body, and a stream that ends without
   * `end` is a failed answer, not one still arriving. `route.continue` points the
   * request here without the page seeing another address, so the client reads a
   * real stream that has simply not finished yet.
   */
  private async openStream(events: AnswerEvent[]): Promise<string> {
    const server = createServer((_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(frames(events));
    });
    this.servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }

  close(): void {
    for (const server of this.servers) {
      server.closeAllConnections();
      server.close();
    }
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

  /** One stored conversation, listed in the sidebar and readable at `/c/<id>`. */
  conversation(detail: ConversationDetail): void {
    const { messages: _, ...summary } = detail;
    this.on("GET", "/api/conversations", () => ({ json: [summary] }));
    this.on("GET", `/api/conversations/${detail.id}`, () => ({ json: detail }));
  }

  /** The catalogue behind every staff page. */
  catalog(): void {
    this.on("GET", "/api/catalog/programmes", () => ({ json: [PROGRAMME] }));
    this.on("GET", `/api/catalog/programmes/${PROGRAMME.code}`, () => ({ json: PROGRAMME }));
    this.on("GET", `/api/catalog/programmes/${PROGRAMME.code}/courses`, () => ({
      json: STUDY_PLAN,
    }));
    this.on("GET", `/api/catalog/courses/${COURSE.code}`, () => ({ json: COURSE }));
    this.on("GET", "/api/catalog/editions", () => ({ json: [EDITION] }));
    this.on("GET", `/api/catalog/editions/${EDITION.id}`, () => ({ json: EDITION }));
  }

  /** Every question gets this stream, whole. */
  answer(events: AnswerEvent[]): void {
    this.on("POST", "/api/ask", (request) => {
      this.asked.push(request.postDataJSON() as AskBody);
      return { sse: events };
    });
  }

  /** Every question gets these events, and then the stream stays open. */
  holdAnswer(events: AnswerEvent[]): void {
    this.on("POST", "/api/ask", (request) => {
      this.asked.push(request.postDataJSON() as AskBody);
      return { open: events };
    });
  }
}

export const test = base.extend<{ api: Api }>({
  api: [
    async ({ page }, use) => {
      const api = new Api(page);
      await api.install();
      await use(api);
      api.close();
      expect(api.unanswered, "requests no fixture answered").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
