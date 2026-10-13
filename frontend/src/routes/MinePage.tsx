/**
 * `/staff/mine`: the editions the reader teaches, one row each, by course
 * and newest year first.
 *
 * Read from the edition list, the caller's scope, keeping the editions whose
 * teachers name the reader: an account that also runs a programme lists that
 * programme's editions too, and those are not its own courses. A row is the
 * course's name over its code (DESIGN.md, rule 1), the year, its state and
 * who teaches it; the name is the row's one link, to the edition, with the
 * year in its accessible name, since a course taught two years has two rows
 * of the same name. Coming back with Back marks the row the reader opened
 * (features/staff/openedRow.ts).
 */

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { type Edition, listEditions } from "@/api/catalog";
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
import { useLoad } from "@/features/staff/context";
import { isNotFound } from "@/features/staff/errors";
import { useOpenedRow } from "@/features/staff/openedRow";
import { Note, PageHead } from "@/features/staff/page";
import { PeopleInline } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

/** The editions `username` teaches, by course in the list's order, newest year first. */
function own(editions: readonly Edition[], username: string): Edition[] {
  const groups = new Map<string, Edition[]>();
  for (const edition of editions) {
    if (!edition.teachers.some((teacher) => teacher.username === username)) continue;
    groups.set(edition.course.code, [...(groups.get(edition.course.code) ?? []), edition]);
  }
  return [...groups.values()].flatMap((group) =>
    group.sort((a, b) => b.academic_year.localeCompare(a.academic_year)),
  );
}

export default function MinePage() {
  const { t } = useTranslation();
  const { account } = useSession();
  const { back } = useShell();
  const editions = useLoad(listEditions);
  const { opened, open } = useOpenedRow(editions.data !== null);
  useCrumbs(isNotFound(editions.error) ? { kind: "notFound" } : { kind: "mine" });

  if (editions.error !== null)
    return (
      <LoadFailure error={editions.error} back={back} onRetry={() => void editions.reload()} />
    );
  if (editions.data === null) return null;
  const rows = own(editions.data, account?.username ?? "");

  return (
    <>
      <PageHead
        heading={t("staff.mine.title")}
        chips={<Chip tone="accent">{t("staff.mine.count", { count: rows.length })}</Chip>}
        sub={t("staff.mine.sub")}
      />
      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
          {t("staff.mine.empty")}
        </p>
      ) : (
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
      )}
      <Note>{t("staff.mine.note")}</Note>
    </>
  );
}
