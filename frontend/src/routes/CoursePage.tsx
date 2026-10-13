/**
 * `/staff/courses/:code`: one course — its editions, and the study plans
 * that list it, each a tab with its count.
 *
 * Which programmes list a course is the public catalogue, so the page names
 * them all, a programme the reader does not run included; who runs that
 * programme stays on its own page, which is a 404 to them. A teacher reads no
 * course page: they reach their editions from their own courses. The path it
 * was reached through is `?programme=` (features/staff/crumbs.ts). An
 * edition's row opens it, and coming back with Back marks the row the reader
 * opened (features/staff/openedRow.ts).
 */

import { ChevronRight } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { listEditions, readCourse } from "@/api/catalog";
import { Chip } from "@/components/ui/chip";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/features/staff/context";
import { contextProgramme, programmeLine, programmesOf } from "@/features/staff/crumbs";
import { isNotFound } from "@/features/staff/errors";
import { useOpenedRow } from "@/features/staff/openedRow";
import { PlanCard } from "@/features/staff/PlanCard";
import { Code, Note, PageHead } from "@/features/staff/page";
import { PeopleInline } from "@/features/staff/people";
import { periodName } from "@/features/staff/period";
import { LoadFailure } from "@/features/staff/Refusal";
import { cn } from "@/lib/utils";
import { useCrumbs, useShell } from "./shell";

export default function CoursePage() {
  const { t, i18n } = useTranslation();
  const { code = "" } = useParams();
  const [search] = useSearchParams();
  const { back, programmes } = useShell();
  const load = useCallback(
    () => Promise.all([readCourse(code), listEditions({ course: code })]),
    [code],
  );
  const page = useLoad(load);
  const course = page.data?.[0] ?? null;
  const { opened, open } = useOpenedRow(page.data !== null);
  const through =
    course === null
      ? null
      : contextProgramme(course.entries, search.get("programme"), programmes ?? []);
  useCrumbs(
    isNotFound(page.error)
      ? { kind: "notFound" }
      : course === null
        ? null
        : { kind: "course", course, programme: through },
  );

  if (page.error !== null)
    return <LoadFailure error={page.error} back={back} onRetry={() => void page.reload()} />;
  if (page.data === null || course === null) return null;
  const [, editions] = page.data;
  const listing = programmesOf(course.entries);
  const query = through === null ? "" : `?${new URLSearchParams({ programme: through.code })}`;

  const editionsTable = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("staff.course.year")}</TableHead>
          <TableHead>{t("staff.period.label")}</TableHead>
          <TableHead>{t("staff.course.status")}</TableHead>
          <TableHead>{t("staff.plan.teachers")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("staff.open")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {editions.map((edition) => (
          <TableRow
            key={edition.id}
            selected={opened === String(edition.id)}
            className="relative cursor-pointer"
          >
            <TableCell>
              <Link
                to={`/staff/editions/${edition.id}${query}`}
                onClick={open(String(edition.id))}
                className="font-semibold tabular-nums after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {edition.academic_year}
              </Link>
            </TableCell>
            <TableCell label={t("staff.period.label")} className="whitespace-nowrap">
              {periodName(edition.period, t) ?? <span className="text-muted">—</span>}
            </TableCell>
            <TableCell label={t("staff.course.status")}>
              <StatusDot on={edition.is_current}>
                {edition.is_current ? t("staff.current") : t("staff.past")}
              </StatusDot>
            </TableCell>
            <TableCell label={t("staff.plan.teachers")}>
              {edition.teachers.length > 0 ? (
                <PeopleInline people={edition.teachers} />
              ) : (
                <span className="whitespace-nowrap text-muted">{t("staff.plan.noTeacher")}</span>
              )}
            </TableCell>
            <TableCell>
              <span className="flex items-center justify-end gap-snug text-muted">
                <ChevronRight aria-hidden className="size-icon max-sm:hidden" />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const plans = (
    <div className="flex flex-col gap-snug">
      <div className={cn("grid gap-snug", listing.length > 1 && "md:grid-cols-2")}>
        {listing.map((programme) => (
          <PlanCard
            key={programme.code}
            entries={course.entries.filter((entry) => entry.programme.code === programme.code)}
          />
        ))}
      </div>
      {listing.length > 1 && (
        <Note>
          {listing.length === 2
            ? t("staff.course.sharedBoth")
            : t("staff.course.sharedAll", { count: listing.length })}
        </Note>
      )}
    </div>
  );

  return (
    <>
      <PageHead
        heading={course.name}
        caps
        chips={
          <>
            <Code>{course.code}</Code>
            {course.code_source === "cineca-only" && <Chip>{t("staff.plan.integrated")}</Chip>}
          </>
        }
        sub={programmeLine(course.entries, i18n.language)}
        source
      />
      <Tabs
        label={course.name}
        defaultValue="editions"
        tabs={[
          {
            value: "editions",
            label: t("staff.course.editions"),
            count: editions.length,
            content: (
              <div className="flex flex-col gap-snug">
                <p className="text-body text-muted">{t("staff.course.editionsSub")}</p>
                {editionsTable}
              </div>
            ),
          },
          {
            value: "plans",
            label: t("staff.course.inPlan"),
            count: listing.length,
            content: plans,
          },
        ]}
      />
    </>
  );
}
