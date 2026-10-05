/**
 * A programme's study plan, searched and narrowed to a curriculum: the view
 * of studyPlan.ts, which holds the rules.
 *
 * Each year of study is a row group whose header sticks to the top of the
 * page while its courses scroll under it, where the screen is wide enough for
 * the table to need no frame of its own (ui/table.tsx). The curriculum filter
 * is a group of toggle buttons, one pressed, rather than a select: there are
 * two or three curricula, and all of them stay in sight. A row opens its
 * course, reached through this programme; the course's name is the row's one
 * link, stretched over it.
 */

import { ChevronRight, Search } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Programme, StudyPlanCourse } from "@/api/catalog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { coursePath } from "./crumbs";
import { PeopleInline } from "./people";
import { type PlanRow, studyPlan } from "./studyPlan";

const NOTE = "block text-caption text-muted";

function Entries({ row }: { row: PlanRow }) {
  const { t } = useTranslation();
  if (row.splitCodes) {
    const codes = row.entries.length;
    return (
      <>
        {row.entries.map((entry) => (
          <span key={entry.curriculum} className="flex flex-wrap gap-x-tight">
            <span className="font-mono">{entry.ad_code}</span>
            <span className="text-muted">{entry.curriculum}</span>
          </span>
        ))}
        <span className={NOTE}>
          {codes === 2 ? t("staff.plan.twoCodes") : t("staff.plan.codes", { count: codes })}
        </span>
      </>
    );
  }
  const { coverage } = row;
  return (
    <span className="flex flex-wrap gap-x-tight">
      <span className="font-mono">{row.entries[0]?.ad_code}</span>
      {coverage !== null && (
        <span className="text-muted">
          {coverage.kind === "only"
            ? t("staff.plan.only", { list: coverage.curricula.join(", ") })
            : t(`staff.plan.${coverage.kind}`)}
        </span>
      )}
    </span>
  );
}

interface StudyPlanTableProps {
  rows: readonly StudyPlanCourse[];
  programme: Programme;
}

export function StudyPlanTable({ rows, programme }: StudyPlanTableProps) {
  const { t } = useTranslation();
  const searchId = useId();
  const [curriculum, setCurriculum] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const groups = studyPlan(rows, programme, curriculum, query);
  const choices: (string | null)[] = [null, ...programme.curricula];

  return (
    <div className="flex flex-col gap-snug">
      <div className="flex flex-wrap items-center gap-snug">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-snug size-icon -translate-y-1/2 text-muted"
          />
          <label htmlFor={searchId} className="sr-only">
            {t("staff.plan.searchLabel")}
          </label>
          <Input
            id={searchId}
            type="search"
            autoComplete="off"
            placeholder={t("staff.plan.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-room"
          />
        </div>
        {programme.curricula.length > 1 && (
          <fieldset className="flex flex-wrap gap-hair rounded-md border border-line p-hair">
            <legend className="sr-only">{t("staff.plan.filter")}</legend>
            {choices.map((choice) => (
              <button
                key={choice ?? ""}
                type="button"
                aria-pressed={choice === curriculum}
                onClick={() => setCurriculum(choice)}
                className={cn(
                  "rounded-sm px-tight py-hair text-caption transition-colors",
                  choice === curriculum
                    ? "bg-mark font-medium text-ink"
                    : "text-muted hover:bg-mark hover:text-ink",
                )}
              >
                {choice ?? t("staff.plan.all")}
              </button>
            ))}
          </fieldset>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-snug py-room text-center text-body text-muted">
          {query.trim() === "" ? t("staff.plan.noCurriculum") : t("staff.plan.noMatch")}
        </p>
      ) : (
        <Table frameClassName="lg:overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.plan.course")}</TableHead>
              <TableHead>{t("staff.plan.entries")}</TableHead>
              <TableHead>{t("staff.plan.current")}</TableHead>
              <TableHead>{t("staff.plan.teachers")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("staff.open")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((group) => (
            <TableBody key={group.year}>
              <tr>
                <th
                  colSpan={5}
                  scope="colgroup"
                  className="sticky top-0 z-10 border-line border-b bg-canvas px-tight py-tight text-left font-semibold text-body text-ink"
                >
                  {t("staff.plan.year", { year: group.year })}{" "}
                  <span className="font-normal text-muted">
                    · {t("staff.plan.count", { count: group.rows.length })}
                  </span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <TableRow key={row.course.code} className="relative cursor-pointer">
                  <TableCell>
                    <Link
                      to={coursePath(row.course.code, programme)}
                      className="block font-medium uppercase after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {row.course.name}
                    </Link>
                    {row.course.code_source === "cineca-only" && (
                      <span className={NOTE}>{t("staff.plan.integrated")}</span>
                    )}
                    {row.others.length > 0 && (
                      <span className={NOTE}>
                        {t("staff.plan.alsoIn", {
                          // Name first, as the prototype writes it in a sentence.
                          list: row.others
                            .map((other) => `${other.name} · ${other.code}`)
                            .join(", "),
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Entries row={row} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.current?.academic_year ?? <span className="text-muted">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.current !== null && row.current.teachers.length > 0 ? (
                      <PeopleInline people={row.current.teachers} />
                    ) : (
                      <span className="whitespace-nowrap text-muted">
                        {t("staff.plan.noTeacher")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted">
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
