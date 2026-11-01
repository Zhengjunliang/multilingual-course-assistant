/**
 * `/staff/system`: the questions and the uploads as they go through the site,
 * Redis and the Celery workers, for the superuser (#236), live.
 *
 * The diagram above (features/system/Topology.tsx) draws where each task is;
 * the list below it the tasks under way and the last finished
 * (RecentTasks.tsx); the panel beside the list the steps of the one picked
 * (TaskPanel.tsx), from either. All of it is the feed of
 * `/api/admin/activity`, read while the page is open
 * (features/system/useActivity.ts). The chip under the heading says whether
 * the feed is live; one that broke is opened again by itself, and the page
 * keeps what it drew meanwhile.
 *
 * Anyone else in the staff area is told the page is not found, as on the
 * ratings' page, and nothing is asked of the server.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/auth/useSession";
import { StatusDot } from "@/components/ui/status-dot";
import { PageHead, Section } from "@/features/staff/page";
import { LoadFailure } from "@/features/staff/Refusal";
import { listed, RECENT } from "@/features/system/feed";
import { RecentTasks } from "@/features/system/RecentTasks";
import { TaskPanel } from "@/features/system/TaskPanel";
import { Legend, Topology } from "@/features/system/Topology";
import { useActivity } from "@/features/system/useActivity";
import { StaffNotFound } from "./StaffLanding";
import { useCrumbs, useShell } from "./shell";

export default function SystemPage() {
  const { account } = useSession();
  if (account === null || !account.is_superuser) return <StaffNotFound />;
  return <System />;
}

function System() {
  const { t } = useTranslation();
  const { back } = useShell();
  const { feed, liveness, error, retry } = useActivity();
  const [selected, setSelected] = useState<string | null>(null);
  useCrumbs({ kind: "system" });

  if (error !== null) return <LoadFailure error={error} back={back} onRetry={retry} />;
  const tasks = listed(feed);
  const task = tasks.find((each) => each.id === selected) ?? null;

  return (
    <>
      <PageHead
        heading={t("staff.system.title")}
        chips={
          <StatusDot on={liveness === "live"} className="text-caption text-muted">
            {t(`staff.system.${liveness}`)}
          </StatusDot>
        }
        sub={t("staff.system.sub")}
      />
      {liveness !== "opening" && (
        <>
          <div className="flex flex-col gap-tight">
            <Topology feed={feed} selected={selected} onSelect={setSelected} />
            <Legend />
          </div>
          <div className="grid items-start gap-room lg:grid-cols-[17rem_minmax(0,1fr)]">
            <TaskPanel task={task} traceUrl={feed.traceUrl} />
            <Section
              heading={t("staff.system.recent")}
              sub={t("staff.system.recentSub", { count: RECENT })}
            >
              <RecentTasks tasks={tasks} selected={selected} onSelect={setSelected} />
            </Section>
          </div>
        </>
      )}
    </>
  );
}
