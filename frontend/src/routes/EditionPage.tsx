/**
 * `/staff/editions/:id`: one academic year of a course, and who teaches it.
 *
 * An edition outside the caller's scope is a 404, and the page says "not
 * found". Its head names the year, whether it is current and, where it was
 * entered, the day its teaching starts, which is what makes it current
 * (apps/catalog/editions.py). Who may assign a teacher here is the edition's
 * `permissions`: the button is in the page's head, and nobody else is offered
 * it. The path it was reached through is `?programme=`, or the teacher's own
 * courses when no programme the reader may view lists it
 * (features/staff/crumbs.ts).
 */

import { useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";

import { readEdition } from "@/api/catalog";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { useMembers } from "@/features/staff/actions";
import { useLoad } from "@/features/staff/context";
import { contextProgramme, programmeLine } from "@/features/staff/crumbs";
import { isNotFound } from "@/features/staff/errors";
import { Code, PageHead } from "@/features/staff/page";
import { StaffList, shownName } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

export default function EditionPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const [search] = useSearchParams();
  const { back, programmes } = useShell();
  const load = useCallback(() => readEdition(Number(id)), [id]);
  const edition = useLoad(load);
  const data = edition.data;
  const assigns = data?.permissions.includes("edition.assign_teacher") ?? false;
  const object = data === null ? "" : `${data.course.name} · ${data.academic_year}`;
  const members = useMembers({
    scope: { kind: "edition", id: Number(id) },
    people: data?.teachers ?? [],
    object,
    description: object,
    canManage: assigns,
    sentence: (person) => (
      <Trans
        i18nKey="staff.revoke.teacher"
        values={{
          username: shownName(person),
          course: data?.course.name ?? "",
          year: data?.academic_year ?? "",
        }}
        components={{ person: <Chip />, course: <Chip />, year: <Chip tone="accent" /> }}
      />
    ),
    reload: edition.reload,
  });
  const through =
    data === null
      ? null
      : contextProgramme(data.course.entries, search.get("programme"), programmes ?? []);
  useCrumbs(
    isNotFound(edition.error)
      ? { kind: "notFound" }
      : data === null
        ? null
        : { kind: "edition", course: data.course, year: data.academic_year, programme: through },
  );

  if (edition.error !== null)
    return <LoadFailure error={edition.error} back={back} onRetry={() => void edition.reload()} />;
  if (data === null) return null;
  const { course, academic_year: year } = data;
  // A calendar day, read and printed in UTC so no time zone moves it.
  const starts =
    data.teaching_starts === null
      ? null
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: "UTC" }).format(
          new Date(data.teaching_starts),
        );

  return (
    <>
      <PageHead
        heading={course.name}
        caps
        chips={
          <>
            <Chip className="tabular-nums">{year}</Chip>
            <Chip tone={data.is_current ? "accent" : "neutral"}>
              {data.is_current ? t("staff.current") : t("staff.past")}
            </Chip>
            {starts !== null && (
              <Chip className="tabular-nums">{t("staff.edition.starts", { date: starts })}</Chip>
            )}
            <Code>{course.code}</Code>
          </>
        }
        sub={programmeLine(course.entries, i18n.language)}
        actions={members.assign}
      />
      <section className="flex flex-col gap-snug">
        <div className="flex items-center gap-tight">
          <h2 className="font-semibold text-ink text-title">{t("staff.edition.teachers")}</h2>
          <Count value={data.teachers.length} />
        </div>
        <StaffList
          people={data.teachers}
          staffRole="teacher"
          empty={t("staff.edition.empty")}
          action={members.action}
        />
      </section>
      {members.dialogs}
    </>
  );
}
