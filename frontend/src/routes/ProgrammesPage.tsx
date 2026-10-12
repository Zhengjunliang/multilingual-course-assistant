/**
 * `/staff/programmes`: the degree programmes the caller may view, each with
 * its curricula, its course count and its secretariat.
 *
 * The whole row opens the programme. Its name, over its code (DESIGN.md,
 * rule 1), is the row's one real link, stretched over the row, so the row is
 * reachable by keyboard and a screen reader hears one link per programme
 * rather than five cells to click. Coming back with Back marks the row the
 * reader opened (features/staff/openedRow.ts).
 */

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { listProgrammes } from "@/api/catalog";
import { useSession } from "@/auth/useSession";
import { Chip } from "@/components/ui/chip";
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

export default function ProgrammesPage() {
  const { t } = useTranslation();
  const { account } = useSession();
  const { back } = useShell();
  const programmes = useLoad(listProgrammes);
  const { opened, open } = useOpenedRow(programmes.data !== null);
  useCrumbs(isNotFound(programmes.error) ? { kind: "notFound" } : { kind: "programmes" });

  if (programmes.error !== null)
    return (
      <LoadFailure error={programmes.error} back={back} onRetry={() => void programmes.reload()} />
    );
  if (programmes.data === null) return null;

  return (
    <>
      <PageHead
        heading={t("staff.programmes.title")}
        chips={
          <Chip tone="accent">
            {t("staff.programmes.count", { count: programmes.data.length })}
          </Chip>
        }
        sub={account?.is_superuser ? t("staff.programmes.sub") : t("staff.programmes.subScoped")}
        source
      />
      {programmes.data.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
          {t("staff.programmes.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-snug">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("staff.nav.programme")}</TableHead>
                <TableHead>{t("staff.programmes.curriculum")}</TableHead>
                <TableHead className="text-right">{t("staff.programmes.courses")}</TableHead>
                <TableHead>{t("staff.programmes.secretariat")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("staff.open")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {programmes.data.map((programme) => (
                <TableRow
                  key={programme.code}
                  selected={opened === programme.code}
                  className="relative cursor-pointer"
                >
                  <TableCell>
                    <Link
                      to={`/staff/programmes/${encodeURIComponent(programme.code)}`}
                      onClick={open(programme.code)}
                      className="block font-semibold uppercase after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {programme.name}
                    </Link>
                    <span className="block font-mono text-caption text-muted">
                      {programme.code}
                    </span>
                  </TableCell>
                  <TableCell label={t("staff.programmes.curriculum")} className="text-caption">
                    {programme.curricula.map((curriculum) => (
                      <span key={curriculum} className="block">
                        {curriculum}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell
                    label={t("staff.programmes.courses")}
                    className="text-right tabular-nums"
                  >
                    {programme.course_count}
                  </TableCell>
                  <TableCell label={t("staff.programmes.secretariat")}>
                    {programme.secretariat.length > 0 ? (
                      <PeopleInline people={programme.secretariat} />
                    ) : (
                      <span className="text-muted">{t("staff.programmes.none")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted max-sm:hidden">
                    <ChevronRight aria-hidden className="size-icon" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Note>{t("staff.programmes.footnote")}</Note>
        </div>
      )}
    </>
  );
}
