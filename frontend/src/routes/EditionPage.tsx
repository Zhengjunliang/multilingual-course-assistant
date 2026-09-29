/**
 * `/staff/editions/:id`: one edition and its teachers. An edition outside the
 * caller's scope is a 404 from the server and "not found" here.
 */

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { type MemberScope, readEdition } from "@/api/catalog";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useLoad } from "@/features/staff/context";
import { MembersPanel } from "@/features/staff/MembersPanel";
import { LoadFailure } from "@/features/staff/NotFound";

export default function EditionPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const load = useCallback(() => readEdition(Number(id)), [id]);
  const edition = useLoad(load);
  const scope = useMemo<MemberScope>(() => ({ kind: "edition", id: Number(id) }), [id]);

  if (edition.error !== null) return <LoadFailure error={edition.error} />;
  if (edition.data === null) return null;
  const { course, academic_year: year } = edition.data;

  return (
    <section className="flex flex-col gap-gutter">
      <Breadcrumb
        label={t("staff.breadcrumb")}
        crumbs={[
          { label: t("staff.editions.title"), to: "/staff/editions" },
          { label: `${course.code} ${year}` },
        ]}
      />
      <header className="flex flex-col gap-hair">
        <h1 className="font-semibold text-ink text-title">
          <span className="font-mono text-muted">{course.code}</span> {course.name}
        </h1>
        <p className="flex items-center gap-tight text-body text-muted">
          {year}
          {edition.data.is_current && <Badge>{t("staff.editions.current")}</Badge>}
        </p>
      </header>
      <MembersPanel
        scope={scope}
        title={t("staff.members.teachers")}
        scopeName={`${course.code} ${year}`}
        canManage={edition.data.permissions.includes("edition.assign_teacher")}
      />
    </section>
  );
}
