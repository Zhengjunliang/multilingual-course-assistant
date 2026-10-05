/**
 * `/staff/courses/:code`: one course — the study plans that list it, and its
 * editions.
 *
 * Which programmes list a course is the public catalogue, so the page names
 * them all, a programme the reader does not run included; who runs that
 * programme stays on its own page, which is a 404 to them. A teacher reads no
 * course page: they reach their editions from their own courses. The path it
 * was reached through is `?programme=` (features/staff/crumbs.ts).
 */

import { ChevronRight } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { type CurriculumEntry, listEditions, readCourse } from "@/api/catalog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSetCurrent } from "@/features/staff/actions";
import { useLoad } from "@/features/staff/context";
import { contextProgramme, programmeLine, programmesOf } from "@/features/staff/crumbs";
import { Note, PageHead, Section } from "@/features/staff/page";
import { PeopleInline } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

/** One programme's card: the course's entries in its study plan. */
function PlanCard({ entries }: { entries: readonly CurriculumEntry[] }) {
  const { t } = useTranslation();
  const programme = entries[0]?.programme;
  const codes = new Set(entries.map((entry) => entry.ad_code)).size;
  return (
    <Card className="overflow-hidden shadow-none">
      <h3 className="flex flex-wrap items-baseline gap-tight border-line border-b px-snug py-tight font-medium text-body text-ink">
        <span className="uppercase">{programme?.name}</span>
        <span className="font-mono text-caption text-muted">{programme?.code}</span>
      </h3>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li
            key={`${entry.curriculum}-${entry.ad_code}`}
            className="flex flex-wrap items-baseline gap-x-snug px-snug py-tight text-body"
          >
            <span className="min-w-0 flex-1 text-ink">{entry.curriculum || "—"}</span>
            <span className="font-mono text-ink">{entry.ad_code}</span>
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
  const switching = useSetCurrent({ editions: page.data?.[1] ?? [], reload: page.reload });
  const through =
    course === null
      ? null
      : contextProgramme(course.entries, search.get("programme"), programmes ?? []);
  useCrumbs(
    page.error !== null
      ? { kind: "notFound" }
      : course === null
        ? null
        : { kind: "course", course, programme: through },
  );

  if (page.error !== null) return <LoadFailure error={page.error} back={back} />;
  if (page.data === null || course === null) return null;
  const [, editions] = page.data;
  const listing = programmesOf(course.entries);
  const query = through === null ? "" : `?${new URLSearchParams({ programme: through.code })}`;

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <span className="font-mono">{course.code}</span>
            {course.code_source === "cineca-only" && <span>{t("staff.plan.integrated")}</span>}
          </>
        }
        title={course.name}
        caps
        sub={programmeLine(course.entries, i18n.language)}
        source
      />
      <Section title={t("staff.course.inPlan")}>
        <div className="grid gap-snug md:grid-cols-2">
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
      </Section>
      <Section title={t("staff.course.editions")} sub={t("staff.course.editionsSub")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.course.year")}</TableHead>
              <TableHead>{t("staff.course.status")}</TableHead>
              <TableHead>{t("staff.plan.teachers")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("staff.open")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editions.map((edition) => (
              <TableRow key={edition.id} className="relative cursor-pointer">
                <TableCell className="font-medium tabular-nums">
                  <Link
                    to={`/staff/editions/${edition.id}${query}`}
                    className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {edition.academic_year}
                  </Link>
                </TableCell>
                <TableCell>
                  {edition.is_current ? (
                    <Badge>{t("staff.current")}</Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {edition.teachers.length > 0 ? (
                    <PeopleInline people={edition.teachers} />
                  ) : (
                    <span className="whitespace-nowrap text-muted">
                      {t("staff.plan.noTeacher")}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-snug text-muted">
                    {switching.button(edition)}
                    <ChevronRight aria-hidden className="size-icon" />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
      {switching.dialog}
    </>
  );
}
