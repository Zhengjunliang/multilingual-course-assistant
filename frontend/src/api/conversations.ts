/**
 * `/api/conversations` — the sidebar, and reopening a thread.
 *
 * A stored message carries the same `citations`, `route` and `search_ms` the
 * `start` event delivered (apps/qa/models.py says why they are columns). That
 * is what lets a reopened conversation render through the very same components
 * as a live one: the pills, the sources and the process line with its seconds
 * all come back, and there is no second rendering path for history to drift
 * from.
 */

import type { Citation, RouteDecision } from "./contract";
import { request } from "./http";

/** A course an answer drew on, as the catalogue names it. */
export interface CourseName {
  name: string;
  /** The language the name is written in; `null` for a code no course holds, shown as stored. */
  locale: string | null;
}

/** What a conversation's newest answer with excerpts drew on (apps/qa/serializers.py). */
export interface ConversationSource {
  /** The slides excerpts' courses, in citation order, each once; the first is the first excerpt's. */
  courses: CourseName[];
  /** Whether any excerpt was one of the university's pages. */
  web: boolean;
}

/**
 * A sidebar row. The list arrives pinned rows first, each group by its last
 * message, newest first; only `pinned` is stored, the rest is derived from the
 * messages server-side.
 */
export interface ConversationSummary {
  /** A random UUID: it names one conversation and counts none. */
  id: string;
  locale: string;
  created_at: string;
  /** The row's time, and what the list is ordered by. */
  last_message_at: string;
  /** The first question, cut short; never stored, never editable. */
  title: string;
  /** The language the first question was asked in: a conversation has no single one. */
  title_locale: string;
  pinned: boolean;
  /** `null` when every answer was refused for want of excerpts. */
  last_source: ConversationSource | null;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  locale: string;
  /**
   * False when the stream stopped without `end` — generation failed, or the
   * reader left. The fragment is kept deliberately: it is what they saw.
   */
  complete: boolean;
  citations: Citation[];
  route: RouteDecision | null;
  /** `StartEvent.search_ms`; `null` on a question. */
  search_ms: number | null;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: StoredMessage[];
  /**
   * The answer a worker is writing into this conversation, `null` when none
   * is. Its question and answer are in `messages` only once the worker has
   * begun, and whole only once it ends, so the page reads it from its stream
   * instead (`GET /api/answers/<id>/events`).
   */
  answering: string | null;
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>("/api/conversations");
}

/** The id comes from an address the reader can type, so it is encoded as a path segment. */
function conversationPath(id: string): string {
  return `/api/conversations/${encodeURIComponent(id)}`;
}

/** The thread root to leaf, as the server walks it; its order is the chain's, not the clock's. */
export function readConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(conversationPath(id));
}

/** Pins or unpins it; the server answers with its row as the list shows it. */
export function pinConversation(id: string, pinned: boolean): Promise<ConversationSummary> {
  return request<ConversationSummary>(conversationPath(id), {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
}

/** Deletes the conversation and its messages for good; the server answers 204. */
export function deleteConversation(id: string): Promise<void> {
  return request<void>(conversationPath(id), { method: "DELETE" });
}
