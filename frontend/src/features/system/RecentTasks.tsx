/**
 * The system page's list (#236): the tasks under way, newest first, then the
 * last finished, as Flower's, Sidekiq's and Bull Board's task lists put them
 * under their dashboards (outside the repository).
 *
 * A row is what the task was, over when it began (DESIGN.md, rule 1), its
 * outcome, how long it took from its first entry to its last, and the
 * worker that ran it. A row selects its task, whose steps the panel beside
 * shows (TaskPanel.tsx): the keyboard's way to what a dot of the diagram
 * selects with the pointer. Nothing names who asked: a question is its
 * opening words, a visitor's not even those.
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Outcome, Task } from "./feed";

/** What a task was: a student's question, a visitor's, or an uploaded file. */
export function taskName(task: Task, t: TFunction): string {
  if (task.kind === "upload") return t("staff.system.upload", { file: task.file ?? "" });
  return task.question ?? t("staff.system.visitor");
}

/** A span of time as the list and the panel say it: "7,9 s", "1 min 42 s". */
export function duration(ms: number, t: TFunction, language: string): string {
  if (ms < 60_000) {
    const seconds = new Intl.NumberFormat(language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(ms / 1000);
    return t("staff.system.duration.seconds", { seconds });
  }
  const whole = Math.round(ms / 1000);
  return t("staff.system.duration.minutes", {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  });
}

const WARN: ReadonlySet<Outcome> = new Set(["error", "failed", "refused", "lost"]);

/** A task's outcome: the accent while under way, the warning's tone for a failure. */
export function OutcomeChip({ outcome }: { outcome: Outcome | null }) {
  const { t } = useTranslation();
  if (outcome === null) return <Chip tone="accent">{t("staff.system.outcome.going")}</Chip>;
  return (
    <Chip tone={WARN.has(outcome) ? "warn" : "neutral"}>
      {t(`staff.system.outcome.${outcome}`)}
    </Chip>
  );
}

interface RecentTasksProps {
  tasks: readonly Task[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function RecentTasks({ tasks, selected, onSelect }: RecentTasksProps) {
  const { t, i18n } = useTranslation();
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" });

  if (tasks.length === 0)
    return (
      <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
        {t("staff.system.none")}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("staff.system.column.what")}</TableHead>
          <TableHead>{t("staff.system.column.outcome")}</TableHead>
          <TableHead>{t("staff.system.column.duration")}</TableHead>
          <TableHead>{t("staff.system.column.worker")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow
            key={task.id}
            selected={task.id === selected}
            className="relative cursor-pointer"
          >
            <TableCell>
              <button
                type="button"
                aria-pressed={task.id === selected}
                onClick={() => onSelect(task.id)}
                className={cn(
                  "line-clamp-2 text-left font-semibold after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent",
                  task.kind === "question" && task.question === null && "text-muted",
                )}
              >
                {taskName(task, t)}
              </button>
              <span className="block text-caption text-muted tabular-nums">
                {time.format(new Date(task.at))}
              </span>
            </TableCell>
            <TableCell label={t("staff.system.column.outcome")} className="whitespace-nowrap">
              <OutcomeChip outcome={task.outcome} />
            </TableCell>
            <TableCell
              label={t("staff.system.column.duration")}
              className="whitespace-nowrap tabular-nums"
            >
              {task.outcome === null || task.outcome === "refused" ? (
                <span className="text-muted">—</span>
              ) : (
                duration(task.last - task.at, t, i18n.language)
              )}
            </TableCell>
            <TableCell label={t("staff.system.column.worker")} className="break-all">
              {task.worker ?? <span className="text-muted">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
