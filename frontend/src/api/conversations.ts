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

import { answerPath } from "./client";
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

/** Why an answer is rated down, as `Feedback.Reason` keys it (apps/qa/models.py); the interface words each. */
export const FEEDBACK_REASONS = ["incorrect", "not_answered", "wrong_language", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** How long a comment may be (`MAX_COMMENT_CHARS`, apps/qa/models.py). */
export const MAX_COMMENT_CHARS = 1024;

/** A student's rating of an answer, as they read it back under it. */
export interface StoredFeedback {
  rating: "up" | "down";
  /** `""` when none was given, and always on a rating up. */
  reason: FeedbackReason | "";
  /** `""` when none was given, and always on a rating up. */
  comment: string;
}

/** A rating as it is sent: the whole of it, which replaces any before (`FeedbackRequest`). */
export interface FeedbackBody {
  rating: "up" | "down";
  /** Only with a rating down. */
  reason?: FeedbackReason;
  /** Only with a rating down. */
  comment?: string;
  /** The interface's language, which the comment is written in; required with one. */
  locale?: string;
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
  /** The owner's rating of an answer; `null` when there is none, and on a question. */
  feedback: StoredFeedback | null;
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
  /** The editions its questions search besides the default, by id (`AskBody.added_editions`). */
  added_editions: number[];
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

/** Rates an answer, replacing any rating before; the server answers with it as stored. */
export function rateAnswer(answerId: string, body: FeedbackBody): Promise<StoredFeedback> {
  return request<StoredFeedback>(`${answerPath(answerId)}/feedback`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Withdraws an answer's rating; the server answers 204, a rating already gone included. */
export function withdrawRating(answerId: string): Promise<void> {
  return request<void>(`${answerPath(answerId)}/feedback`, { method: "DELETE" });
}
