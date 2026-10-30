/**
 * `/api/admin/feedback` — the superuser's page of ratings
 * (apps/qa/feedback_views.py).
 *
 * The shapes mirror apps/qa/feedback_serializers.py, which is the single
 * source; tests/test_qa_contract.py fails when the two drift. None of them
 * names the student who rated.
 */

import type { HistoryTurn } from "./client";
import type { Citation, RouteDecision } from "./contract";
import type { FeedbackReason } from "./conversations";

/** The rows of a page of ratings: the server's `FeedbackPagination.page_size`. */
export const FEEDBACK_PAGE_SIZE = 50;

/** A rating in the list, newest first. */
export interface FeedbackRow {
  /** The rated answer's id, which keys its rating. */
  id: string;
  rating: "up" | "down";
  reason: FeedbackReason | "";
  comment: string;
  updated_at: string;
  question: string;
  /** Where the answer was searched, the scenario; `null` for an answer stored without a route. */
  target: RouteDecision["target"] | null;
  /** The language the question was asked and answered in. */
  locale: string;
}

/** The answer a rating rates, as the stream delivered it. */
export interface RatedAnswer {
  text: string;
  locale: string;
  complete: boolean;
  citations: Citation[];
  route: RouteDecision | null;
  search_ms: number | null;
  /** The id of the request that produced it, which files its log lines; `""` before it was kept. */
  request_id: string;
  created_at: string;
}

/** One rating opened. */
export interface FeedbackDetail {
  id: string;
  rating: "up" | "down";
  reason: FeedbackReason | "";
  comment: string;
  /** The language the comment is written in; `""` without one. */
  comment_locale: string;
  created_at: string;
  updated_at: string;
  question: string;
  answer: RatedAnswer;
  /** The exchanges the question was asked with, oldest first, cut as the prompt was. */
  history: HistoryTurn[];
}
