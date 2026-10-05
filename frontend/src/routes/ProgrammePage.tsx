/**
 * `/staff/programmes/:code`: one programme — its study plan, and its
 * secretariat.
 *
 * The programme and its study plan are two reads made together; a programme
 * outside the caller's scope is a 404 on both, and the page says "not found".
 * Only the superuser assigns secretariat staff, which the programme's
 * `permissions` say; anyone else reads who they are and why they cannot.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { listStudyPlan, readProgramme } from "@/api/catalog";
import { Card } from "@/components/ui/card";
import { useLoad } from "@/features/staff/context";
import { Note, PageHead, Section } from "@/features/staff/page";
import { StaffList } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { StudyPlanTable } from "@/features/staff/StudyPlanTable";
import { useCrumbs, useShell } from "./shell";

export default function ProgrammePage() {
  const { t } = useTranslation();
  const { code = "" } = useParams();
  const { back } = useShell();
  const load = useCallback(() => Promise.all([readProgramme(code), listStudyPlan(code)]), [code]);
  const page = useLoad(load);
  const programme = page.data?.[0] ?? null;
  useCrumbs(
    page.error !== null
      ? { kind: "notFound" }
      : programme === null
        ? null
        : { kind: "programme", programme },
  );

  if (page.error !== null) return <LoadFailure error={page.error} back={back} />;
  if (page.data === null || programme === null) return null;
  const [, plan] = page.data;
  const assigns = programme.permissions.includes("programme.assign_secretariat");

  return (
    <>
      <PageHead
        eyebrow={<span className="font-mono">{programme.code}</span>}
        title={programme.name}
        caps
        sub={
          programme.curricula.length > 0
            ? t("staff.plan.curricula", { list: programme.curricula.join(" · ") })
            : undefined
        }
        source
      />
      <Section title={t("staff.plan.title")} sub={t("staff.plan.sub", { count: plan.length })}>
        <StudyPlanTable rows={plan} programme={programme} />
      </Section>
      <Section title={t("staff.secretariat.title")} sub={t("staff.secretariat.sub")}>
        <Card className="overflow-hidden shadow-none">
          <StaffList people={programme.secretariat} empty={t("staff.secretariat.empty")} />
          {!assigns && <Note foot>{t("staff.secretariat.onlyAdmin")}</Note>}
        </Card>
      </Section>
    </>
  );
}
