/**
 * `/api/conversations` — the sidebar, and reopening a thread.
 *
 * A stored message carries the same `citations` and `route` the `start` event
 * delivered (apps/qa/models.py says why they are columns). That is what lets a
 * reopened conversation render through the very same components as a live one:
 * badges, greyed-out sources and the routing line all come back, and there is
 * no second rendering path for history to drift from.
 */

import type { Citation, RouteDecision } from "./contract";
import { request } from "./http";

export interface ConversationSummary {
  id: number;
  locale: string;
  created_at: string;
  /** Derived from the first question server-side; never stored, never editable. */
  title: string;
}

export interface StoredMessage {
  id: number;
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
}

export interface ConversationDetail extends ConversationSummary {
  messages: StoredMessage[];
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>("/api/conversations");
}

export function readConversation(id: number): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/conversations/${id}`);
}
