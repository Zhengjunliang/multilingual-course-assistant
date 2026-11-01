/**
 * The steps of the task the reader picked on the system page (#236), in the
 * list the chat shows its reader (features/chat/StepList.tsx): a question's
 * as its student saw them, an upload's as its ingest went.
 *
 * Under them, the worker that ran it and, for a signed-in student's question,
 * the request's id, to copy, and the way to its trace in Langfuse once the
 * answer is over: Langfuse receives a trace only after its spans end, and
 * only of a question a worker began answering, so one refused at the cap,
 * lost, or stopped as it was taken has no way there. A visitor's question
 * has neither, since only a signed-in student's answer is
 * traced (docs/decisions.md, 2026-10-31, *A signed-in student's answer is a
 * trace in Langfuse that names nobody and goes with its conversation*,
 * point 1).
 */

import { Check, Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { StepList } from "@/features/chat/StepList";
import { useCopy } from "@/features/chat/useCopy";
import type { Task } from "./feed";
import { OutcomeChip, taskName } from "./RecentTasks";

interface TaskPanelProps {
  task: Task | null;
  /** Where a trace opens once its id is appended; `null` with tracing off. */
  traceUrl: string | null;
}

export function TaskPanel({ task, traceUrl }: TaskPanelProps) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  const heading = t("staff.system.steps");

  return (
    <section
      aria-label={heading}
      className="flex flex-col gap-snug rounded-card border border-line bg-surface p-snug"
    >
      <h2 className="font-semibold text-ink text-title">{heading}</h2>
      {task === null ? (
        <p className="text-body text-muted">{t("staff.system.pick")}</p>
      ) : (
        <>
          <div className="flex flex-col gap-tight">
            <p className="text-body text-ink">{taskName(task, t)}</p>
            <div>
              <OutcomeChip outcome={task.outcome} />
            </div>
          </div>
          <div className="text-body text-ink">
            <StepList
              steps={task.steps}
              found={task.found}
              cited={null}
              chunks={task.chunks}
              live={task.outcome === null}
            />
          </div>
          <div className="flex flex-col gap-hair text-caption text-muted">
            {task.worker !== null && <p>{t("staff.system.worker", { name: task.worker })}</p>}
            {task.code !== null && <p>{t("staff.system.code", { code: task.code })}</p>}
            {task.question !== null && task.requestId !== null && (
              <>
                <div className="flex flex-col">
                  <p className="flex items-center gap-tight">
                    {t("staff.system.request")}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t(copied ? "staff.system.copied" : "staff.system.copy")}
                      onClick={() => void copy(task.requestId ?? "")}
                    >
                      {copied ? (
                        <Check aria-hidden className="size-icon" />
                      ) : (
                        <Copy aria-hidden className="size-icon" />
                      )}
                    </Button>
                  </p>
                  <code className="break-all font-mono text-ink">{task.requestId}</code>
                </div>
                {traceUrl !== null && task.outcome !== null && task.answering && (
                  <a
                    href={`${traceUrl}${encodeURIComponent(task.requestId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-hair text-accent text-body underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {t("staff.system.langfuse")}
                    <ExternalLink aria-hidden className="size-icon" />
                  </a>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
