/**
 * `/staff/programmes/:code`: one programme — its study plan, and its
 * secretariat, each a tab with its count.
 *
 * The programme and its study plan are two reads made together; a programme
 * outside the caller's scope is a 404 on both, and the page says "not found".
 * Only the superuser assigns and revokes secretariat staff, which the
 * programme's `permissions` say; anyone else reads who they are, and a
 * banner where the button would be says why they cannot. The plan's count is
 * the rows its tab shows before any filter: a course two years of study list
 * is two rows (features/staff/studyPlan.ts).
 */

import { Lock } from "lucide-react";
import { useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { listStudyPlan, readProgramme } from "@/api/catalog";
import { Banner } from "@/components/ui/banner";
import { Chip } from "@/components/ui/chip";
import { Tabs } from "@/components/ui/tabs";
import { useMembers } from "@/features/staff/actions";
import { useLoad } from "@/features/staff/context";
import { isNotFound } from "@/features/staff/errors";
import { Code, PageHead } from "@/features/staff/page";
import { StaffList, shownName } from "@/features/staff/people";
import { LoadFailure } from "@/features/staff/Refusal";
import { StudyPlanTable } from "@/features/staff/StudyPlanTable";
import { rowCount, studyPlan } from "@/features/staff/studyPlan";
import { useCrumbs, useShell } from "./shell";

export default function ProgrammePage() {
  const { t } = useTranslation();
  const { code = "" } = useParams();
  const { back } = useShell();
  const load = useCallback(() => Promise.all([readProgramme(code), listStudyPlan(code)]), [code]);
  const page = useLoad(load);
  const programme = page.data?.[0] ?? null;
  const assigns = programme?.permissions.includes("programme.assign_secretariat") ?? false;
  const members = useMembers({
    scope: { kind: "programme", code },
    people: programme?.secretariat ?? [],
    object: programme?.code ?? code,
    description: programme === null ? code : `${programme.name} · ${programme.code}`,
    canManage: assigns,
    sentence: (person) => (
      <Trans
        i18nKey="staff.revoke.secretariat"
        values={{ username: shownName(person), programme: programme?.name ?? code }}
        components={{ person: <Chip />, programme: <Chip /> }}
      />
    ),
    reload: page.reload,
  });
  useCrumbs(
    isNotFound(page.error)
      ? { kind: "notFound" }
      : programme === null
        ? null
        : { kind: "programme", programme },
  );

  if (page.error !== null)
    return <LoadFailure error={page.error} back={back} onRetry={() => void page.reload()} />;
  if (page.data === null || programme === null) return null;
  const [, plan] = page.data;

  return (
    <>
      <PageHead
        heading={programme.name}
        caps
        chips={
          <>
            <Code>{programme.code}</Code>
            {programme.curricula.map((curriculum) => (
              <Chip key={curriculum}>{curriculum}</Chip>
            ))}
            <Chip tone="accent">{t("staff.plan.count", { count: programme.course_count })}</Chip>
          </>
        }
        source
      />
      <Tabs
        label={programme.name}
        defaultValue="plan"
        tabs={[
          {
            value: "plan",
            label: t("staff.plan.title"),
            count: rowCount(studyPlan(plan, programme, null, "")),
            content: <StudyPlanTable rows={plan} programme={programme} />,
          },
          {
            value: "secretariat",
            label: t("staff.secretariat.title"),
            count: programme.secretariat.length,
            content: (
              <div className="flex flex-col gap-snug">
                <div className="flex flex-wrap items-center gap-snug">
                  <p className="min-w-0 flex-1 text-body text-muted">
                    {t("staff.secretariat.sub")}
                  </p>
                  {members.assign}
                </div>
                {!assigns && (
                  <Banner icon={Lock} heading={t("staff.refusal.cannot.assignSecretariat")} />
                )}
                <StaffList
                  people={programme.secretariat}
                  staffRole="secretariat"
                  empty={t("staff.secretariat.empty")}
                  action={members.action}
                />
              </div>
            ),
          },
        ]}
      />
      {members.dialogs}
    </>
  );
}
