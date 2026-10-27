/**
 * A sidebar row as `GET /api/conversations` sends it, for the tests that need
 * one: what a test is about is written out, the rest takes a value nothing
 * asserts on. The time defaults to when the conversation started, as for a
 * conversation of one exchange.
 */

import type { ConversationSummary } from "@/api/conversations";

/**
 * A fixed UUID ending in `n`, the shape every conversation and message id
 * has, kept readable: `uuidOf(7)` is told from `uuidOf(8)` at a glance.
 */
export function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function summary(
  row: Pick<ConversationSummary, "id" | "title"> & Partial<ConversationSummary>,
): ConversationSummary {
  const created_at = row.created_at ?? "2026-09-28T10:00:00Z";
  return {
    locale: "it",
    created_at,
    last_message_at: created_at,
    title_locale: "it",
    pinned: false,
    last_source: { courses: [], web: true },
    ...row,
  };
}
