/**
 * `/staff/mine`: the editions the reader teaches, one card per course.
 *
 * Read from the edition list, the caller's scope, keeping the editions whose
 * teachers name the reader: an account that also runs a programme lists that
 * programme's editions too, and those are not its own courses.
 */

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { type Edition, listEditions } from "@/api/catalog";
import { useSession } from "@/auth/useSession";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useSetCurrent } from "@/features/staff/actions";
import { useLoad } from "@/features/staff/context";
import { programmeLine } from "@/features/staff/crumbs";
import { isNotFound } from "@/features/staff/errors";
import { Note, PageHead } from "@/features/staff/page";
import { PeopleInline } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

/** The editions `username` teaches, by course in the list's order, newest year first. */
function byCourse(editions: readonly Edition[], username: string): Edition[][] {
  const groups = new Map<string, Edition[]>();
  for (const edition of editions) {
    if (!edition.teachers.some((teacher) => teacher.username === username)) continue;
    groups.set(edition.course.code, [...(groups.get(edition.course.code) ?? []), edition]);
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => b.academic_year.localeCompare(a.academic_year)),
  );
}

export default function MinePage() {
  const { t, i18n } = useTranslation();
  const { account } = useSession();
  const { back } = useShell();
  const editions = useLoad(listEditions);
  const switching = useSetCurrent({ editions: editions.data ?? [], reload: editions.reload });
  useCrumbs(isNotFound(editions.error) ? { kind: "notFound" } : { kind: "mine" });

  if (editions.error !== null)
    return (
      <LoadFailure error={editions.error} back={back} onRetry={() => void editions.reload()} />
    );
  if (editions.data === null) return null;
  const groups = byCourse(editions.data, account?.username ?? "");

  return (
    <>
      <PageHead title={t("staff.mine.title")} sub={t("staff.mine.sub")} />
      {groups.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-snug py-room text-center text-body text-muted">
          {t("staff.mine.empty")}
        </p>
      ) : (
        groups.map((group) => {
          const course = group[0]?.course;
          if (course === undefined) return null;
          return (
            <Card key={course.code} className="overflow-hidden shadow-none">
              <div className="flex flex-col gap-hair border-line border-b px-snug py-tight">
                <h2 className="font-semibold text-body text-ink uppercase">{course.name}</h2>
                <p className="text-caption text-muted">
                  <span className="font-mono">{course.code}</span> ·{" "}
                  {programmeLine(course.entries, i18n.language)}
                </p>
              </div>
              <ul className="flex flex-col divide-y divide-line">
                {group.map((edition) => (
                  <li
                    key={edition.id}
                    className="relative flex flex-wrap items-center gap-snug px-snug py-tight hover:bg-mark"
                  >
                    <span className="flex shrink-0 items-center gap-tight">
                      <Link
                        to={`/staff/editions/${edition.id}`}
                        className="font-medium text-body text-ink tabular-nums after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {edition.academic_year}
                      </Link>
                      {edition.is_current && <Badge>{t("staff.current")}</Badge>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <PeopleInline people={edition.teachers} />
                    </span>
                    {switching.button(edition)}
                    <ChevronRight aria-hidden className="size-icon text-muted" />
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
      <Note>{t("staff.mine.note")}</Note>
      {switching.dialog}
    </>
  );
}
