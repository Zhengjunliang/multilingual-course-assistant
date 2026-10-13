/**
 * An edition's syllabus, the first tab of its page: the seven sections of the
 * Cineca course catalogue as numbered tabs down the side, in its order, one
 * shown at a time (components/ui/section-tabs.tsx). Each says under its name
 * whether it has text; the one shown says where it stands among the seven,
 * and leads to the ones either side.
 *
 * The syllabus is written in one language, the edition's, whatever the
 * interface's (docs/decisions.md,
 * 2026-09-25, *The data model is decided on paper*, point 4): its text is
 * shown as written and tagged with it.
 * Whoever holds `edition.edit_content` chooses it under the sections, where
 * the choice is sent on its own and changes no text; anyone else reads it
 * there. Each section is edited in its own panel (SectionText.tsx), and
 * every panel stays mounted, so a section half written is still there after
 * a look at another. A standing status line says what was saved, since the
 * box closing is all a screen reader would otherwise miss.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { type SyllabusSectionKey, setSyllabusLocale } from "@/api/catalog";
import { Select } from "@/components/ui/field";
import { SectionTabs } from "@/components/ui/section-tabs";
import { endonym, isUiLocale, UI_LOCALES, type UiLocale } from "@/i18n";
import { useFailure } from "../context";
import { isNotFound } from "../errors";
import { PartFailure } from "../Refusal";
import { SectionText } from "./SectionText";
import { type EditionSyllabus, SECTION_NAME, SECTIONS } from "./syllabus";

interface SyllabusPanelProps {
  edition: number;
  syllabus: EditionSyllabus;
  /** Whether the reader holds `edition.edit_content`. */
  editable: boolean;
  /** Reads the page again, after a write found the edition gone. */
  reloadPage: () => Promise<boolean>;
}

export function SyllabusPanel({ edition, syllabus, editable, reloadPage }: SyllabusPanelProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const [shown, setShown] = useState<SyllabusSectionKey>(SECTIONS[0] ?? "obiettivi_formativi");
  const [status, setStatus] = useState("");
  /** The language being sent, shown in the select until the server answers. */
  const [choosing, setChoosing] = useState<UiLocale | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { locale } = syllabus;

  if (syllabus.error !== null) return <PartFailure onRetry={() => void syllabus.reload()} />;
  if (locale === null) return null;

  const choose = async (next: UiLocale) => {
    setChoosing(next);
    setRefusal(null);
    try {
      const answered = await setSyllabusLocale(edition, next);
      syllabus.relabelled(answered.locale);
      setStatus(t("staff.syllabus.relabelled", { language: endonym(answered.locale) }));
    } catch (error) {
      // The edition left the reader's reach: the page reads again, and says so.
      if (isNotFound(error)) await reloadPage();
      else setRefusal(fail(error));
    } finally {
      setChoosing(null);
    }
  };

  const language = editable ? (
    <Select
      id={`syllabus-${edition}-locale`}
      label={t("staff.syllabus.language")}
      value={choosing ?? locale}
      onChange={(event) => {
        if (isUiLocale(event.target.value)) void choose(event.target.value);
      }}
      error={refusal ?? undefined}
      options={UI_LOCALES.map((option) => ({
        value: option,
        label: endonym(option),
        lang: option,
      }))}
    />
  ) : (
    <p className="flex flex-col gap-hair text-body">
      <span className="font-semibold text-ink">{t("staff.syllabus.language")}</span>
      <span lang={locale} className="text-muted">
        {endonym(locale)}
      </span>
    </p>
  );

  return (
    <>
      <p role="status" className="sr-only">
        {status}
      </p>
      <SectionTabs
        label={t("staff.syllabus.sections")}
        value={shown}
        onValueChange={setShown}
        steps={{ previous: t("staff.syllabus.previous"), next: t("staff.syllabus.next") }}
        foot={language}
        sections={SECTIONS.map((section, at) => {
          const text = syllabus.text(section);
          return {
            value: section,
            label: t(SECTION_NAME[section]),
            caption: t(text === "" ? "staff.syllabus.blank" : "staff.syllabus.written"),
            content: (
              <SectionText
                edition={edition}
                locale={locale}
                section={section}
                position={at + 1}
                total={SECTIONS.length}
                name={t(SECTION_NAME[section])}
                text={text}
                editable={editable}
                onSaved={(row, message) => {
                  syllabus.saved(row);
                  setStatus(message);
                }}
                reloadPage={reloadPage}
              />
            ),
          };
        })}
      />
    </>
  );
}
