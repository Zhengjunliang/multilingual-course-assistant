/**
 * `/staff/editions/:id`: one academic year of a course, and who teaches it.
 *
 * An edition outside the caller's scope is a 404, and the page says "not
 * found". Who may assign a teacher here is the edition's `permissions`; anyone
 * else reads who teaches it and why they cannot change that. The course's
 * other editions are read too, for the one a switch to this edition replaces. The path it was
 * reached through is `?programme=`, or the teacher's own courses when no
 * programme the reader may view lists it (features/staff/crumbs.ts).
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";

import { listEditions, readEdition } from "@/api/catalog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useMembers, useSetCurrent } from "@/features/staff/actions";
import { useLoad } from "@/features/staff/context";
import { contextProgramme, programmeLine } from "@/features/staff/crumbs";
import { Code, Note, PageHead } from "@/features/staff/page";
import { StaffList } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

export default function EditionPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const [search] = useSearchParams();
  const { back, programmes } = useShell();
  const load = useCallback(
    () =>
      readEdition(Number(id)).then(
        async (read) => [read, await listEditions({ course: read.course.code })] as const,
      ),
    [id],
  );
  const edition = useLoad(load);
  const data = edition.data?.[0] ?? null;
  const assigns = data?.permissions.includes("edition.assign_teacher") ?? false;
  const object = data === null ? "" : `${data.course.name} · ${data.academic_year}`;
  const members = useMembers({
    scope: { kind: "edition", id: Number(id) },
    people: data?.teachers ?? [],
    object,
    description: object,
    canManage: assigns,
    sentence: (username) =>
      t("staff.revoke.teacher", {
        username,
        course: data?.course.name ?? "",
        year: data?.academic_year ?? "",
      }),
    reload: edition.reload,
  });
  const switching = useSetCurrent({ editions: edition.data?.[1] ?? [], reload: edition.reload });
  const through =
    data === null
      ? null
      : contextProgramme(data.course.entries, search.get("programme"), programmes ?? []);
  useCrumbs(
    edition.error !== null
      ? { kind: "notFound" }
      : data === null
        ? null
        : { kind: "edition", course: data.course, year: data.academic_year, programme: through },
  );

  if (edition.error !== null)
    return <LoadFailure error={edition.error} back={back} onRetry={() => void edition.reload()} />;
  if (data === null) return null;
  const { course, academic_year: year } = data;

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Code>{`${course.code} · ${year}`}</Code>
            {data.is_current && <Badge>{t("staff.current")}</Badge>}
          </>
        }
        title={course.name}
        caps
        sub={t("staff.edition.sub", {
          year,
          programmes: programmeLine(course.entries, i18n.language),
        })}
        actions={switching.button(data)}
      />
      <Card className="overflow-hidden shadow-none">
        <div className="flex flex-wrap items-center gap-snug border-line border-b px-snug py-tight">
          <h2 className="min-w-0 flex-1 font-semibold text-body text-ink">
            {t("staff.edition.teachers")}
          </h2>
          {members.assign}
        </div>
        <StaffList
          people={data.teachers}
          empty={t("staff.edition.empty")}
          action={members.action}
        />
        {!assigns && <Note foot>{t("staff.edition.onlyStaff")}</Note>}
      </Card>
      {members.dialogs}
      {switching.dialog}
    </>
  );
}
