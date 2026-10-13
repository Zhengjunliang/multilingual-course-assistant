/**
 * Which editions "I miei insegnamenti" lists: every edition of each course
 * the reader teaches an edition of, since a teacher covers all of their
 * course's years (docs/decisions.md, 2026-09-29, *Staff permissions are a
 * registry in code*, point 1), and, by default, only those that are not over.
 *
 * The default view is the current edition of each course and any newer one
 * already set up, the next year's, as GitHub Issues opens on the open ones
 * and Blackboard on the current courses; the full history is one link away,
 * `?show=all`, which Back and a link passed on both keep. A course none of
 * whose editions has started keeps its newest in the default view.
 */

import type { Edition } from "@/api/catalog";

export type Show = "current" | "all";

/** The view a `?show=` value names; anything else is the default. */
export function shown(value: string | null): Show {
  return value === "all" ? "all" : "current";
}

/**
 * Every edition of each course `username` teaches an edition of, grouped by
 * course in the list's order, newest year first: an account that also runs
 * a programme lists that programme's editions too, and those are not its own.
 */
export function ownCourses(editions: readonly Edition[], username: string): Edition[][] {
  const taught = new Set(
    editions
      .filter((edition) => edition.teachers.some((teacher) => teacher.username === username))
      .map((edition) => edition.course.code),
  );
  const groups = new Map<string, Edition[]>();
  for (const edition of editions) {
    if (!taught.has(edition.course.code)) continue;
    groups.set(edition.course.code, [...(groups.get(edition.course.code) ?? []), edition]);
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => b.academic_year.localeCompare(a.academic_year)),
  );
}

/** A course's current edition and the newer ones, or its newest when none is current; `group` is newest first. */
export function notOver(group: readonly Edition[]): Edition[] {
  const current = group.findIndex((edition) => edition.is_current);
  return group.slice(0, current === -1 ? 1 : current + 1);
}
