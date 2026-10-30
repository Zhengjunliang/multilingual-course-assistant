/**
 * `/staff/editions/:id`: one academic year of a course, its syllabus, its
 * reading list, its material and who teaches it, each a tab under the page's
 * head that counts what it holds: the sections written, the books, the
 * files, the teachers.
 *
 * An edition outside the caller's scope is a 404, and the page says "not
 * found". Its head names the year, whether it is current and, where it was
 * entered, the day its teaching starts, which is what makes it current
 * (apps/catalog/editions.py). Who may assign a teacher here is the edition's
 * `permissions`, which a course's teachers hold on its current and later
 * editions: the button is in the page's head, beside the one that makes
 * an invitation (features/staff/Invitations.tsx), and nobody else is offered
 * either; the invitations not accepted yet are under the teachers. The
 * syllabus and the books are read beside the edition, so their tabs can count
 * them, and written on their own (features/staff/content/), by whoever holds
 * `edition.edit_content`. The material tab is there only for whoever holds
 * `edition.manage_materials`, its list read once the edition says so
 * (features/staff/content/MaterialPanel.tsx). The path the page was reached
 * through is `?programme=`, or the teacher's own courses when no programme
 * the reader may view lists it (features/staff/crumbs.ts).
 */

import { useCallback, useMemo } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";

import { listMaterials, listReadings, readEdition } from "@/api/catalog";
import { Chip } from "@/components/ui/chip";
import { Tabs } from "@/components/ui/tabs";
import { useMembers } from "@/features/staff/actions";
import { MaterialPanel } from "@/features/staff/content/MaterialPanel";
import { ReadingList } from "@/features/staff/content/ReadingList";
import { SyllabusPanel } from "@/features/staff/content/SyllabusPanel";
import { useSyllabus } from "@/features/staff/content/syllabus";
import { useLoad } from "@/features/staff/context";
import { contextProgramme, programmeLine } from "@/features/staff/crumbs";
import { isNotFound } from "@/features/staff/errors";
import { useInvitations } from "@/features/staff/Invitations";
import { Code, PageHead } from "@/features/staff/page";
import { StaffList, shownName } from "@/features/staff/people";
import { periodName } from "@/features/staff/period";
import { LoadFailure } from "@/features/staff/Refusal";
import { DEFAULT_UI_LOCALE } from "@/i18n";
import { useCrumbs, useShell } from "./shell";

export default function EditionPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const [search] = useSearchParams();
  const { back, programmes } = useShell();
  const load = useCallback(() => readEdition(Number(id)), [id]);
  const edition = useLoad(load);
  const syllabus = useSyllabus(Number(id));
  const loadBooks = useCallback(() => listReadings(Number(id)), [id]);
  const books = useLoad(loadBooks);
  const data = edition.data;
  const assigns = data?.permissions.includes("edition.assign_teacher") ?? false;
  const edits = data?.permissions.includes("edition.edit_content") ?? false;
  const manages = data?.permissions.includes("edition.manage_materials") ?? false;
  const loadMaterials = useCallback(
    () => (manages ? listMaterials(Number(id)) : Promise.resolve([])),
    [id, manages],
  );
  const materials = useLoad(loadMaterials);
  const object = data === null ? "" : `${data.course.name} · ${data.academic_year}`;
  const scope = useMemo(() => ({ kind: "edition", id: Number(id) }) as const, [id]);
  const members = useMembers({
    scope,
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
    gone: isNotFound(edition.error),
  });
  const invitations = useInvitations({
    scope,
    canInvite: assigns,
    object,
    reloadPage: edition.reload,
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
  const period = periodName(data.period, t);
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
            {period !== null && <Chip>{period}</Chip>}
            {starts !== null && (
              <Chip className="tabular-nums">{t("staff.edition.starts", { date: starts })}</Chip>
            )}
            <Code>{course.code}</Code>
          </>
        }
        sub={programmeLine(course.entries, i18n.language)}
        actions={
          <>
            {members.assign}
            {invitations.invite}
          </>
        }
      />
      <Tabs
        label={t("staff.edition.views")}
        defaultValue="syllabus"
        tabs={[
          {
            value: "syllabus",
            label: t("staff.syllabus.title"),
            count: syllabus.written ?? undefined,
            content: (
              <SyllabusPanel
                edition={data.id}
                syllabus={syllabus}
                editable={edits}
                reloadPage={edition.reload}
              />
            ),
          },
          {
            value: "readings",
            label: t("staff.readings.title"),
            count: books.data?.length,
            content: (
              <ReadingList
                edition={data.id}
                books={books}
                language={syllabus.locale ?? DEFAULT_UI_LOCALE}
                editable={edits}
                reloadPage={edition.reload}
              />
            ),
          },
          ...(manages
            ? [
                {
                  value: "materials",
                  label: t("staff.materials.title"),
                  count: materials.data?.length,
                  content: (
                    <MaterialPanel
                      edition={data.id}
                      materials={materials}
                      reloadPage={edition.reload}
                    />
                  ),
                },
              ]
            : []),
          {
            value: "teachers",
            label: t("staff.edition.teachers"),
            count: data.teachers.length,
            content: (
              <div className="flex flex-col gap-room">
                <StaffList
                  people={data.teachers}
                  staffRole="teacher"
                  empty={t("staff.edition.empty")}
                  action={members.action}
                />
                {invitations.list}
              </div>
            ),
          },
        ]}
      />
      {members.dialogs}
      {invitations.dialogs}
    </>
  );
}
