/**
 * `/api/scope` — the courses a signed-in reader's questions may search, for
 * the composer to add editions from (#36).
 *
 * The server works it out from the account on every request: the editions of
 * the declared programme's courses that have started, and those a role lets
 * the reader view (apps/qa/scope.py). A conversation adds editions with its
 * next question (`AskBody.added_editions`), which the server checks against
 * the same boundary, so this list grants nothing. apps/qa/scope_serializers.py
 * is the single source; tests/test_scope_contract.py fails when either side
 * moves alone.
 */

import { request } from "./http";

/** Where an edition stands in its course's years, on the day the list was read. */
export type EditionState = "current" | "past" | "upcoming";

export interface ScopeEdition {
  id: number;
  academic_year: string;
  state: EditionState;
  /**
   * Searched without the conversation adding it: a course's current edition,
   * and a teacher's editions that are not past.
   */
  default: boolean;
}

export interface ScopeCourse {
  code: string;
  name: string;
  /** The language `name` is written in. */
  locale: string;
  /** Its earliest year in the reader's declared programme; `null` for a course only a role brings. */
  year_of_study: number | null;
  /** Newest first. */
  editions: ScopeEdition[];
}

/**
 * The reader's own year first, then the programme's other years in order, then
 * the courses a role alone brings; empty without a programme or a role.
 */
export function readScope(): Promise<ScopeCourse[]> {
  return request<ScopeCourse[]>("/api/scope");
}
