/**
 * A sidebar row as `GET /api/conversations` sends it, for the tests that need
 * one: what a test is about is written out, the rest takes a value nothing
 * asserts on. The time defaults to when the conversation started, as for a
 * conversation of one exchange.
 */

import type { ConversationSummary } from "@/api/conversations";

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
