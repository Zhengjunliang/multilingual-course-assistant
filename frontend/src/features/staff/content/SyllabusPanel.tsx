/**
 * An edition's syllabus on its page: the seven sections of the Cineca course
 * catalogue, in its order, one language at a time.
 *
 * The languages are the site's three, as tabs, each counting the sections it
 * has text for; the interface's language is shown first. Every tab stays
 * mounted, so a section half written in one language is still there after a
 * look at another. A section with no text says so.
 *
 * Whoever holds `edition.edit_content` edits each section in place
 * (SectionText.tsx). A saved section shows what the server answered, and the
 * syllabus is not read again: a read that failed would take every other
 * section's box away, with what was half written in it. A standing status
 * line says what was saved, since the box closing is all a screen reader
 * would otherwise miss.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { listSyllabus, type SyllabusSection, type SyllabusSectionKey } from "@/api/catalog";
import { Tabs } from "@/components/ui/tabs";
import { DEFAULT_UI_LOCALE, endonym, isUiLocale, UI_LOCALES, type UiLocale } from "@/i18n";
import { useLoad } from "../context";
import { Section } from "../page";
import { PartFailure } from "../Refusal";
import { SectionText } from "./SectionText";

/** Each section's name, in the catalogue's order; a section added to the contract fails `tsc` here. */
const SECTION_NAME: Record<SyllabusSectionKey, `staff.syllabus.section.${SyllabusSectionKey}`> = {
  obiettivi_formativi: "staff.syllabus.section.obiettivi_formativi",
  prerequisiti: "staff.syllabus.section.prerequisiti",
  contenuti: "staff.syllabus.section.contenuti",
  programma_esteso: "staff.syllabus.section.programma_esteso",
  metodi_didattici: "staff.syllabus.section.metodi_didattici",
  verifica_apprendimento: "staff.syllabus.section.verifica_apprendimento",
  altro: "staff.syllabus.section.altro",
};

const SECTIONS = Object.keys(SECTION_NAME) as SyllabusSectionKey[];

const same = (a: SyllabusSection, b: SyllabusSection) =>
  a.locale === b.locale && a.section === b.section;

/** A section's text in a language; empty when the syllabus has no row for it. */
function textOf(
  rows: readonly SyllabusSection[],
  locale: UiLocale,
  section: SyllabusSectionKey,
): string {
  return rows.find((row) => row.locale === locale && row.section === section)?.text ?? "";
}

interface SyllabusPanelProps {
  edition: number;
  /** Whether the reader holds `edition.edit_content`. */
  editable: boolean;
  /** Reads the page again, after a write found the edition gone. */
  reloadPage: () => Promise<boolean>;
}

export function SyllabusPanel({ edition, editable, reloadPage }: SyllabusPanelProps) {
  const { t, i18n } = useTranslation();
  const load = useCallback(() => listSyllabus(edition), [edition]);
  const syllabus = useLoad(load);
  const [status, setStatus] = useState("");
  /** Each section as its last write answered, an empty text for one cleared. */
  const [written, setWritten] = useState<readonly SyllabusSection[]>([]);
  const rows =
    syllabus.data === null
      ? null
      : [
          ...syllabus.data.filter((row) => !written.some((write) => same(write, row))),
          ...written.filter((write) => write.text !== ""),
        ];

  const saved = (row: SyllabusSection, message: string) => {
    setWritten((shown) => [...shown.filter((write) => !same(write, row)), row]);
    setStatus(message);
  };

  return (
    <Section heading={t("staff.syllabus.title")} sub={t("staff.syllabus.sub")}>
      <p role="status" className="sr-only">
        {status}
      </p>
      {syllabus.error !== null ? (
        <PartFailure onRetry={() => void syllabus.reload()} />
      ) : (
        rows !== null && (
          <Tabs
            label={t("staff.syllabus.languages")}
            defaultValue={isUiLocale(i18n.language) ? i18n.language : DEFAULT_UI_LOCALE}
            tabs={UI_LOCALES.map((locale) => ({
              value: locale,
              label: endonym(locale),
              count: rows.filter((row) => row.locale === locale).length,
              content: (
                <ol className="flex flex-col divide-y divide-hairline rounded-card border border-line bg-surface">
                  {SECTIONS.map((section) => (
                    <SectionText
                      key={section}
                      edition={edition}
                      locale={locale}
                      section={section}
                      name={t(SECTION_NAME[section])}
                      text={textOf(rows, locale, section)}
                      editable={editable}
                      onSaved={saved}
                      reloadPage={reloadPage}
                    />
                  ))}
                </ol>
              ),
            }))}
          />
        )
      )}
    </Section>
  );
}
