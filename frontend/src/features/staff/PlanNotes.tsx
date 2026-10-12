/**
 * What a study plan's row says under the course's name, in `text-caption`
 * and `muted` (DESIGN.md, rule 1): its code and which curricula list it, or
 * each curriculum's own code where they differ; then, where they hold, that
 * the course is an integrated one whose code comes from Cineca, and which
 * other programmes list it too.
 */

import { useTranslation } from "react-i18next";

import type { PlanRow } from "./studyPlan";

const LINE = "block text-caption text-muted";

/** `items` as a phrase of the reader's language, as crumbs.ts's `programmeLine` writes one. */
function list(items: readonly string[], language: string): string {
  return new Intl.ListFormat(language, { type: "conjunction" }).format(items);
}

function Codes({ row }: { row: PlanRow }) {
  const { t, i18n } = useTranslation();
  if (row.splitCodes) {
    const codes = row.entries.length;
    return (
      <span className={LINE}>
        {row.entries.map((entry) => (
          <span key={entry.curriculum} className="me-tight inline-block">
            <span className="font-mono">{entry.ad_code}</span> {entry.curriculum}
          </span>
        ))}
        {codes === 2 ? t("staff.plan.twoCodes") : t("staff.plan.codes", { count: codes })}
      </span>
    );
  }
  const { coverage } = row;
  return (
    <span className={LINE}>
      <span className="font-mono">{row.entries[0]?.ad_code}</span>
      {coverage !== null &&
        ` · ${
          coverage.kind === "only"
            ? t("staff.plan.only", { list: list(coverage.curricula, i18n.language) })
            : t(`staff.plan.${coverage.kind}`)
        }`}
    </span>
  );
}

export function PlanNotes({ row }: { row: PlanRow }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <Codes row={row} />
      {row.course.code_source === "cineca-only" && (
        <span className={LINE}>{t("staff.plan.integrated")}</span>
      )}
      {row.others.length > 0 && (
        <span className={LINE}>
          {t("staff.plan.alsoIn", {
            // Name first, as the prototype writes it in a sentence.
            list: list(
              row.others.map((other) => `${other.name} · ${other.code}`),
              i18n.language,
            ),
          })}
        </span>
      )}
    </>
  );
}
