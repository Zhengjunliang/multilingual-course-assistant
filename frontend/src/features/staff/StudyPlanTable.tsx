/**
 * A programme's study plan, narrowed to a year of study and a curriculum and
 * searched: the view of studyPlan.ts, which holds the rules.
 *
 * Above the table, the search, which `/` reaches from anywhere on the page
 * (features/chat/shortcuts.ts), and two toggle groups: the year of study,
 * each option with the rows it shows (DESIGN.md, rule 5), and, where there
 * are two or more, the curriculum. The years offered are the whole plan's,
 * so an option does not vanish while a search leaves it nothing. Each year of
 * study is a row group whose header sticks to the top of the page while its
 * courses scroll under it, where the screen is wide enough for the table to
 * need no frame of its own (ui/table.tsx). A row opens its course, reached
 * through this programme: the course's name is the row's one link, stretched
 * over it, and its code and the curricula that list it are the line under it
 * (rule 1). Coming back with Back marks the row the reader opened
 * (openedRow.ts), a course under two years being two rows.
 */

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Programme, StudyPlanCourse } from "@/api/catalog";
import { Count } from "@/components/ui/count";
import { SearchField } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { FILTER, isFilterKey } from "@/features/chat/shortcuts";
import { coursePath } from "./crumbs";
import { useOpenedRow } from "./openedRow";
import { PlanNotes } from "./PlanNotes";
import { PeopleInline } from "./people";
import { studyPlan, yearCounts } from "./studyPlan";

/**
 * The value of the option that keeps every year, or every curriculum. Not
 * the empty string, which Radix's toggle group takes for no value at all, so
 * that «Tutti» would show unchosen; no curriculum is named `*`.
 */
const ALL = "*";

interface StudyPlanTableProps {
  rows: readonly StudyPlanCourse[];
  programme: Programme;
}

export function StudyPlanTable({ rows, programme }: StudyPlanTableProps) {
  const { t } = useTranslation();
  const [curriculum, setCurriculum] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const { opened, open } = useOpenedRow(true);
  const groups = studyPlan(rows, programme, curriculum === ALL ? null : curriculum, query);
  const years = studyPlan(rows, programme, null, "").map((group) => group.year);
  const counts = yearCounts(years, groups);
  const shown = groups.filter((group) => year === ALL || String(group.year) === year);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field = search.current;
      if (field === null || !isFilterKey(event)) return;
      // The plan may be behind another tab, which keeps it mounted (ui/tabs.tsx).
      if (field.closest('[role="tabpanel"][data-state="inactive"]') !== null) return;
      // Or the "/" would be typed into the field it just reached.
      event.preventDefault();
      field.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col gap-snug">
      <div className="flex flex-wrap items-center gap-snug">
        <ToggleGroup
          label={t("staff.plan.yearFilter")}
          value={year}
          onValueChange={setYear}
          options={[
            {
              value: ALL,
              label: t("staff.plan.all"),
              count: counts.reduce((n, c) => n + c.count, 0),
            },
            ...counts.map(({ year: each, count }) => ({
              value: String(each),
              label: t("staff.plan.year", { year: each }),
              count,
            })),
          ]}
        />
        {programme.curricula.length > 1 && (
          <ToggleGroup
            label={t("staff.plan.filter")}
            value={curriculum}
            onValueChange={setCurriculum}
            options={[
              { value: ALL, label: t("staff.plan.all") },
              ...programme.curricula.map((each) => ({ value: each, label: each })),
            ]}
          />
        )}
        <SearchField
          ref={search}
          label={t("staff.plan.searchLabel")}
          shortcut={FILTER}
          autoComplete="off"
          placeholder={t("staff.plan.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 basis-56"
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
          {/* With nothing searched, only the curriculum can leave a year empty:
              every year the options offer has a course in some curriculum.
              A plan with no year lists no course at all. */}
          {years.length === 0
            ? t("staff.plan.none")
            : query.trim() === ""
              ? t("staff.plan.noCurriculum")
              : t("staff.plan.noMatch")}
        </p>
      ) : (
        <Table frameClassName="lg:overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.plan.course")}</TableHead>
              <TableHead>{t("staff.plan.current")}</TableHead>
              <TableHead>{t("staff.plan.teachers")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("staff.open")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {shown.map((group) => (
            <TableBody key={group.year}>
              {/* Its roles stated, as in table.tsx: the row stacks with the cards. */}
              {/* biome-ignore lint/a11y/noRedundantRoles: restores the role a stacked table loses in WebKit */}
              <tr role="row">
                {/* biome-ignore lint/a11y/useSemanticElements: restores the role a stacked table loses in WebKit */}
                <th
                  role="columnheader"
                  colSpan={4}
                  scope="colgroup"
                  className="sticky top-0 z-lifted border-hairline border-b px-snug py-tight text-left font-semibold text-body text-ink max-sm:block max-sm:bg-ground sm:bg-surface"
                >
                  <span className="flex items-center gap-tight">
                    {t("staff.plan.year", { year: group.year })}
                    {/* The count read as words, which a bare figure after a year is not. */}
                    <span aria-hidden>
                      <Count value={group.rows.length} />
                    </span>
                    <span className="sr-only">
                      {` · ${t("staff.plan.count", { count: group.rows.length })}`}
                    </span>
                  </span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <TableRow
                  key={row.course.code}
                  selected={opened === `${row.course.code}:${group.year}`}
                  className="relative cursor-pointer"
                >
                  <TableCell>
                    <Link
                      to={coursePath(row.course.code, programme)}
                      onClick={open(`${row.course.code}:${group.year}`)}
                      className="block font-semibold uppercase after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {row.course.name}
                    </Link>
                    <PlanNotes row={row} />
                  </TableCell>
                  <TableCell
                    label={t("staff.plan.current")}
                    className="whitespace-nowrap tabular-nums"
                  >
                    {row.current?.academic_year ?? <span className="text-muted">—</span>}
                  </TableCell>
                  <TableCell label={t("staff.plan.teachers")}>
                    {row.current !== null && row.current.teachers.length > 0 ? (
                      <PeopleInline people={row.current.teachers} />
                    ) : (
                      <span className="whitespace-nowrap text-muted">
                        {t("staff.plan.noTeacher")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted max-sm:hidden">
                    <ChevronRight aria-hidden className="size-icon" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      )}
    </div>
  );
}
