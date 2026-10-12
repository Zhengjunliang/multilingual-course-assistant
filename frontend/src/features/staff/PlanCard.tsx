/**
 * One programme's entries for a course, on the course's page: a card whose
 * head names the programme over its code (DESIGN.md, rule 1), then one row
 * per curriculum with the code it lists the course under and its year of
 * study, and a note when the curricula list it under different codes.
 */

import { useTranslation } from "react-i18next";

import type { CurriculumEntry } from "@/api/catalog";
import { Card, CardHeader } from "@/components/ui/card";
import { Code, Note } from "./page";

export function PlanCard({ entries }: { entries: readonly CurriculumEntry[] }) {
  const { t } = useTranslation();
  const programme = entries[0]?.programme;
  const codes = new Set(entries.map((entry) => entry.ad_code)).size;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        heading={<span className="uppercase">{programme?.name}</span>}
        caption={<span className="font-mono">{programme?.code}</span>}
        className="border-line border-b"
      />
      <ul className="flex flex-col divide-y divide-hairline">
        {entries.map((entry) => (
          <li
            key={`${entry.curriculum}-${entry.ad_code}`}
            className="flex flex-wrap items-center gap-x-snug gap-y-hair px-gutter py-tight text-body"
          >
            <span className="min-w-0 flex-1 text-ink">{entry.curriculum || "—"}</span>
            <Code>{entry.ad_code}</Code>
            <span className="text-muted">
              {t("staff.plan.year", { year: entry.year_of_study })}
            </span>
          </li>
        ))}
      </ul>
      {codes > 1 && (
        <Note foot>
          {entries.length === 2 ? t("staff.course.twoCodesBoth") : t("staff.course.twoCodesAll")}
        </Note>
      )}
    </Card>
  );
}
