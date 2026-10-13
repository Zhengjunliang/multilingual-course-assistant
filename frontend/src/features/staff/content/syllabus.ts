/**
 * An edition's syllabus as its page holds it: read once, then each write shown
 * as the server answered it.
 *
 * The syllabus is not read again after a write: a read that failed would take
 * every section away, with what was half written in it. A saved section shows
 * the text its write answered, an emptied one none, and a new language is the
 * one the server answered with. The page reads it, rather than its panel, so
 * the tab that opens it can count the sections written.
 */

import { useCallback, useState } from "react";

import { readSyllabus, type SyllabusSection, type SyllabusSectionKey } from "@/api/catalog";
import type { UiLocale } from "@/i18n";
import { useLoad } from "../context";

/** Each section's name, in the catalogue's order; a section added to the contract fails `tsc` here. */
export const SECTION_NAME: Record<
  SyllabusSectionKey,
  `staff.syllabus.section.${SyllabusSectionKey}`
> = {
  obiettivi_formativi: "staff.syllabus.section.obiettivi_formativi",
  prerequisiti: "staff.syllabus.section.prerequisiti",
  contenuti: "staff.syllabus.section.contenuti",
  programma_esteso: "staff.syllabus.section.programma_esteso",
  metodi_didattici: "staff.syllabus.section.metodi_didattici",
  verifica_apprendimento: "staff.syllabus.section.verifica_apprendimento",
  altro: "staff.syllabus.section.altro",
};

export const SECTIONS = Object.keys(SECTION_NAME) as SyllabusSectionKey[];

export interface EditionSyllabus {
  /** The language every section is written in; null until the syllabus is read. */
  locale: UiLocale | null;
  error: unknown;
  reload: () => Promise<boolean>;
  /** A section's text; empty when it has none. */
  text: (section: SyllabusSectionKey) => string;
  /** How many sections have text; null until the syllabus is read. */
  written: number | null;
  /** Shows a section as its write answered it: its text, or none once emptied. */
  saved: (row: SyllabusSection) => void;
  /** Shows the language the server answered a change with. */
  relabelled: (locale: UiLocale) => void;
}

interface Shown {
  edition: number;
  writes: Partial<Record<SyllabusSectionKey, string>>;
  locale: UiLocale | null;
}

export function useSyllabus(edition: number): EditionSyllabus {
  const load = useCallback(() => readSyllabus(edition), [edition]);
  const syllabus = useLoad(load);
  // What was written here, for this edition: another edition's page, reached
  // through the history, starts from its own read.
  const [shown, setShown] = useState<Shown>({ edition, writes: {}, locale: null });
  if (shown.edition !== edition) setShown({ edition, writes: {}, locale: null });
  const data = syllabus.data;

  const text = (section: SyllabusSectionKey) =>
    shown.writes[section] ?? data?.sections.find((row) => row.section === section)?.text ?? "";

  return {
    locale: data === null ? null : (shown.locale ?? data.locale),
    error: syllabus.error,
    reload: syllabus.reload,
    text,
    written: data === null ? null : SECTIONS.filter((section) => text(section) !== "").length,
    saved: (row) =>
      setShown((current) => ({
        ...current,
        writes: { ...current.writes, [row.section]: row.text },
      })),
    relabelled: (locale) => setShown((current) => ({ ...current, locale })),
  };
}
