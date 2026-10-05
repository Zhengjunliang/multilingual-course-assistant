/**
 * A programme's study plan as its page shows it: grouped by year of study,
 * narrowed to one curriculum, searched by name or code.
 *
 * In the browser and not on the server: the plan is one request of a few
 * dozen rows, and filtering it here answers each keystroke at once with
 * nothing to wait for. Past a few hundred rows that trade stops holding, and
 * the server would filter and page instead (docs/decisions.md,
 * 2026-10-05, *The staff pages live in the chat shell*, point 4).
 *
 * The rows are the server's, one per course, each carrying its entries in
 * every programme. A course appears under each year of study its entries in
 * this programme name, with only those entries; the curriculum filter keeps
 * the entries of one curriculum, and the search keeps the courses whose name
 * or any code holds the query, accents and case aside.
 */

import type {
  Course,
  CurriculumEntry,
  EditionSummary,
  Programme,
  ProgrammeName,
  StudyPlanCourse,
} from "@/api/catalog";

/** Which of the programme's curricula list the course, said only when it is one code for all. */
export type Coverage =
  | { kind: "both" }
  | { kind: "every" }
  | { kind: "only"; curricula: readonly string[] };

export interface PlanRow {
  course: Course;
  /** This programme's entries for the row's year, after the curriculum filter. */
  entries: readonly CurriculumEntry[];
  /** True when the entries list different codes for the course, each to be shown. */
  splitCodes: boolean;
  coverage: Coverage | null;
  /** The other programmes whose study plan lists the course. */
  others: readonly ProgrammeName[];
  current: EditionSummary | null;
}

export interface PlanGroup {
  year: number;
  rows: readonly PlanRow[];
}

/** `text` without accents and case, so "calcolabilita" finds "CALCOLABILITÀ". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function distinct<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function found(course: Course, query: string): boolean {
  if (query === "") return true;
  const codes = [course.code, ...course.entries.map((entry) => entry.ad_code)];
  return [course.name, ...codes].some((text) => fold(text).includes(query));
}

function coverage(
  entries: readonly CurriculumEntry[],
  curricula: readonly string[],
): Coverage | null {
  // A programme with one curriculum or none has nothing to tell apart.
  if (curricula.length < 2) return null;
  if (entries.length === curricula.length) {
    return curricula.length === 2 ? { kind: "both" } : { kind: "every" };
  }
  return { kind: "only", curricula: entries.map((entry) => entry.curriculum) };
}

/**
 * The groups to show, by year of study, each course by name; empty when no
 * course is left. `curriculum` is `null` for every curriculum.
 */
export function studyPlan(
  rows: readonly StudyPlanCourse[],
  programme: Pick<Programme, "code" | "curricula">,
  curriculum: string | null,
  query: string,
): PlanGroup[] {
  const wanted = fold(query.trim());
  const groups = new Map<number, PlanRow[]>();
  for (const { course, current_edition } of rows) {
    if (!found(course, wanted)) continue;
    const own = course.entries.filter(
      (entry) =>
        entry.programme.code === programme.code &&
        (curriculum === null || entry.curriculum === curriculum),
    );
    const others = distinct(
      course.entries.map((entry) => entry.programme).filter((p) => p.code !== programme.code),
      (p) => p.code,
    );
    for (const year of new Set(own.map((entry) => entry.year_of_study))) {
      const entries = own.filter((entry) => entry.year_of_study === year);
      const splitCodes =
        curriculum === null && new Set(entries.map((entry) => entry.ad_code)).size > 1;
      const row: PlanRow = {
        course,
        entries,
        splitCodes,
        coverage:
          curriculum === null && !splitCodes ? coverage(entries, programme.curricula) : null,
        others,
        current: current_edition,
      };
      groups.set(year, [...(groups.get(year) ?? []), row]);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => ({
      year,
      rows: list.sort((a, b) => a.course.name.localeCompare(b.course.name, "it")),
    }));
}
