/**
 * The breadcrumb above a staff page, as the prototype builds it.
 *
 * Its root is the reader's first Gestione item (landing.ts): "Corsi di
 * laurea", a link to the list, for whoever has the list; "Corso di laurea",
 * plain text, for whoever has one programme and so no page above it; "I miei
 * insegnamenti" for a teacher. The page itself is the last crumb, which
 * `Breadcrumb` marks as the current page.
 *
 * A course or an edition is reached through a programme, and the path names
 * it: the one the link came from (`?programme=`), when the reader may view it
 * and it lists the course, else the first such programme. With none — a
 * teacher, who views no programme — an edition sits under the teacher's own
 * courses.
 */

import type { TFunction } from "i18next";

import type { CurriculumEntry, ProgrammeName } from "@/api/catalog";
import type { Crumb } from "@/components/ui/breadcrumb";
import type { ManagementKey } from "./landing";

interface Named {
  code: string;
  name: string;
}

export type StaffPage =
  | { kind: "programmes" }
  | { kind: "programme"; programme: ProgrammeName }
  | { kind: "course"; course: Named; programme: ProgrammeName | null }
  | { kind: "edition"; course: Named; year: string; programme: ProgrammeName | null }
  | { kind: "mine" }
  | { kind: "notFound" };

export function programmeLabel(programme: ProgrammeName): string {
  return `${programme.code} · ${programme.name}`;
}

/** The programmes whose study plan lists a course, each once, in the order of its entries. */
export function programmesOf(entries: readonly CurriculumEntry[]): ProgrammeName[] {
  const seen = new Set<string>();
  return entries
    .map((entry) => entry.programme)
    .filter((programme) => !seen.has(programme.code) && Boolean(seen.add(programme.code)));
}

/** Those programmes as a phrase of the reader's language: "A · B047 e B · B222". */
export function programmeLine(entries: readonly CurriculumEntry[], language: string): string {
  const names = programmesOf(entries).map((programme) => `${programme.name} · ${programme.code}`);
  return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
}

/** The programme a course's page is reached through, of those `visible` to the reader. */
export function contextProgramme(
  entries: readonly CurriculumEntry[],
  wanted: string | null,
  visible: readonly { code: string }[],
): ProgrammeName | null {
  const seen = new Set(visible.map((programme) => programme.code));
  const listing = entries.map((entry) => entry.programme).filter((p) => seen.has(p.code));
  return listing.find((p) => p.code === wanted) ?? listing[0] ?? null;
}

/** The address of a course's page, reached through `programme`. */
export function coursePath(code: string, programme: ProgrammeName | null): string {
  const query = programme === null ? "" : `?${new URLSearchParams({ programme: programme.code })}`;
  return `/staff/courses/${encodeURIComponent(code)}${query}`;
}

export function crumbs(page: StaffPage, root: ManagementKey | null, t: TFunction): Crumb[] {
  const mine = { label: t("staff.nav.mine"), to: "/staff/mine" };
  const through = (programme: ProgrammeName): Crumb[] => [
    root === "programmes"
      ? { label: t("staff.nav.programmes"), to: "/staff/programmes" }
      : { label: t("staff.nav.programme") },
    {
      label: programmeLabel(programme),
      to: `/staff/programmes/${encodeURIComponent(programme.code)}`,
    },
  ];
  switch (page.kind) {
    case "programmes":
      return [{ label: t("staff.programmes.title") }];
    case "programme":
      return through(page.programme);
    case "course":
      return [
        ...(page.programme === null ? [] : through(page.programme)),
        { label: page.course.name },
      ];
    case "edition":
      if (page.programme === null) return [mine, { label: `${page.course.name} · ${page.year}` }];
      return [
        ...through(page.programme),
        { label: page.course.name, to: coursePath(page.course.code, page.programme) },
        { label: page.year },
      ];
    case "mine":
      return [{ label: t("staff.nav.mine") }];
    case "notFound":
      return [...(root === "mine" ? [mine] : []), { label: t("staff.refusal.notFound") }];
  }
}
