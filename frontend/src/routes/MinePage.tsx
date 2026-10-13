/**
 * `/staff/mine`: the courses the reader teaches, one row per edition, by
 * course and newest year first.
 *
 * Read from the edition list, the caller's scope, keeping every edition of
 * the courses whose teachers name the reader in some year; by default only
 * those not over, `?show=all` for all of them (features/staff/mine.ts). A
 * row is the course's name over its code (DESIGN.md, rule 1), the year, its
 * state and who teaches it; the name is the row's one link, to the edition,
 * with the year in its accessible name, since a course has a row per year.
 * Coming back with Back marks the row the reader opened, in the view it was
 * opened from (features/staff/openedRow.ts).
 */

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { listEditions } from "@/api/catalog";
import { useSession } from "@/auth/useSession";
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
import { TabLinks } from "@/components/ui/tabs";
import { useLoad } from "@/features/staff/context";
import { isNotFound } from "@/features/staff/errors";
import { notOver, ownCourses, shown } from "@/features/staff/mine";
import { useOpenedRow } from "@/features/staff/openedRow";
import { PageHead } from "@/features/staff/page";
import { PeopleInline } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

export default function MinePage() {
  const { t } = useTranslation();
  const { account } = useSession();
  const { back } = useShell();
  const [search] = useSearchParams();
  const show = shown(search.get("show"));
  const editions = useLoad(listEditions);
  const { opened, open } = useOpenedRow(editions.data !== null);
  useCrumbs(isNotFound(editions.error) ? { kind: "notFound" } : { kind: "mine" });

  if (editions.error !== null)
    return (
      <LoadFailure error={editions.error} back={back} onRetry={() => void editions.reload()} />
    );
  if (editions.data === null) return null;
  const courses = ownCourses(editions.data, account?.username ?? "");
  const all = courses.flat();
  const current = courses.flatMap(notOver);
  const rows = show === "all" ? all : current;

  return (
    <>
      <PageHead
        heading={t("staff.mine.title")}
        chips={<Chip tone="accent">{t("staff.plan.count", { count: courses.length })}</Chip>}
        sub={t("staff.mine.sub")}
      />
      {all.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
          {t("staff.mine.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-snug">
          <TabLinks
            label={t("staff.mine.show")}
            links={[
              {
                to: "/staff/mine",
                label: t("staff.mine.current"),
                count: current.length,
                current: show === "current",
              },
              {
                to: "/staff/mine?show=all",
                label: t("staff.mine.all"),
                count: all.length,
                current: show === "all",
              },
            ]}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("staff.plan.course")}</TableHead>
                <TableHead>{t("staff.course.year")}</TableHead>
                <TableHead>{t("staff.course.status")}</TableHead>
                <TableHead>{t("staff.plan.teachers")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("staff.open")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((edition) => (
                <TableRow
                  key={edition.id}
                  selected={opened === String(edition.id)}
                  className="relative cursor-pointer"
                >
                  <TableCell>
                    <Link
                      to={`/staff/editions/${edition.id}`}
                      onClick={open(String(edition.id))}
                      className="block font-semibold uppercase after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {edition.course.name}
                      <span className="sr-only">{` · ${edition.academic_year}`}</span>
                    </Link>
                    <span className="block font-mono text-caption text-muted">
                      {edition.course.code}
                    </span>
                  </TableCell>
                  <TableCell
                    label={t("staff.course.year")}
                    className="whitespace-nowrap tabular-nums"
                  >
                    {edition.academic_year}
                  </TableCell>
                  <TableCell label={t("staff.course.status")}>
                    <StatusDot on={edition.is_current}>
                      {edition.is_current ? t("staff.current") : t("staff.past")}
                    </StatusDot>
                  </TableCell>
                  <TableCell label={t("staff.plan.teachers")}>
                    <PeopleInline people={edition.teachers} />
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
        </div>
      )}
    </>
  );
}
