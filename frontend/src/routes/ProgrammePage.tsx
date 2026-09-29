/**
 * `/staff/programmes/:code`: one programme, its secretariat staff, and a link
 * to the editions of the courses it offers. Only the superuser assigns
 * secretariat staff, which the programme's `permissions` say.
 */

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { type MemberScope, readProgramme } from "@/api/catalog";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useLoad } from "@/features/staff/context";
import { MembersPanel } from "@/features/staff/MembersPanel";
import { LoadFailure } from "@/features/staff/NotFound";

export default function ProgrammePage() {
  const { t } = useTranslation();
  const { code = "" } = useParams();
  const load = useCallback(() => readProgramme(code), [code]);
  const programme = useLoad(load);
  const scope = useMemo<MemberScope>(() => ({ kind: "programme", code }), [code]);

  if (programme.error !== null) return <LoadFailure error={programme.error} />;
  if (programme.data === null) return null;

  return (
    <section className="flex flex-col gap-gutter">
      <Breadcrumb
        label={t("staff.breadcrumb")}
        crumbs={[
          { label: t("staff.programmes.title"), to: "/staff/programmes" },
          { label: programme.data.code },
        ]}
      />
      <header className="flex flex-col gap-hair">
        <h1 className="font-semibold text-ink text-title">
          <span className="font-mono text-muted">{programme.data.code}</span> {programme.data.name}
        </h1>
        <Link
          to={`/staff/editions?${new URLSearchParams({ programme: code })}`}
          className="self-start text-body text-ink underline"
        >
          {t("staff.programmes.editions")}
        </Link>
      </header>
      <MembersPanel
        scope={scope}
        title={t("staff.members.secretariat")}
        scopeName={programme.data.code}
        canManage={programme.data.permissions.includes("programme.assign_secretariat")}
      />
    </section>
  );
}
