/**
 * The editions a signed-in reader's conversation searches besides the default,
 * and the course list they are added from (#36).
 *
 * What a question may search at all is the server's to say, from the account
 * (apps/qa/scope.py); the reader chooses which of the editions it offers the
 * conversation adds: a past year of a course or, for staff, one not started
 * yet. The choice belongs to the conversation, as Onyx keeps a chat session's
 * filters (outside the repository): it goes with the conversation's next
 * question and is stored with it, comes back when the conversation is opened
 * again (`ConversationDetail.added_editions`), and a new conversation starts
 * without any. A choice never asked with is not kept.
 *
 * The page holds it with the thread (`useAsk`), since opening a conversation,
 * starting a new one and a question's `start` are what change it; this file
 * reads the list and works out what a click makes of the choice.
 */

import { readScope, type ScopeCourse } from "@/api/scope";
import { type Loaded, useLoad } from "@/features/staff/context";

/** The editions of `courses` the reader may add: those a question does not search unadded. */
function offered(courses: readonly ScopeCourse[]): Set<number> {
  return new Set(
    courses.flatMap((course) =>
      course.editions.filter((edition) => !edition.default).map((edition) => edition.id),
    ),
  );
}

/**
 * Of what the conversation adds, the editions the list still offers. One the
 * account no longer reads, a role or a programme having changed since, is not
 * searched any more (apps/qa/scope.py), so it is neither shown nor counted.
 */
export function shownAdded(courses: readonly ScopeCourse[], added: readonly number[]): number[] {
  const open = offered(courses);
  return added.filter((id) => open.has(id));
}

/** The choice after a click on edition `id`: added, or taken out if it was there. */
export function toggled(
  courses: readonly ScopeCourse[],
  added: readonly number[],
  id: number,
): number[] {
  const shown = shownAdded(courses, added);
  return shown.includes(id) ? shown.filter((other) => other !== id) : [...shown, id];
}

/** Whether two choices name the same editions, in whatever order. */
export function sameEditions(one: readonly number[], other: readonly number[]): boolean {
  return one.length === other.length && one.every((id) => other.includes(id));
}

const NOBODY = (): Promise<null> => Promise.resolve(null);

/** The course list, read as the page opens; `null` for a visitor, who adds nothing, and until it arrives. */
export function useScope(visitor: boolean): Loaded<ScopeCourse[] | null> {
  return useLoad<ScopeCourse[] | null>(visitor ? NOBODY : readScope);
}
