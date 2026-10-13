/**
 * `/staff/editions/:id`: one academic year of a course, and who teaches it.
 *
 * An edition outside the caller's scope is a 404, and the page says "not
 * found". Who may assign a teacher here is the edition's `permissions`: the
 * button is in the page's head beside the switch, and anyone else reads, in a
 * banner where it would be, why they cannot, with the way back to their own
 * start. The path it was reached through is `?programme=`,
 * or the teacher's own courses when no programme the reader may view lists
 * it (features/staff/crumbs.ts).
 */

import { ArrowLeft, Lock } from "lucide-react";
import { useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { readEdition } from "@/api/catalog";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
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
            <Code>{course.code}</Code>
          </>
        }
        sub={programmeLine(course.entries, i18n.language)}
        actions={members.assign}
      />
      {!assigns && (
        <Banner
          icon={Lock}
          heading={t("staff.refusal.cannot.assignTeacher")}
          action={
            <Link to={back.to} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ArrowLeft aria-hidden className="size-icon" />
              {back.label}
            </Link>
          }
        >
          {t("staff.edition.onlyStaff")}
        </Banner>
      )}
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
