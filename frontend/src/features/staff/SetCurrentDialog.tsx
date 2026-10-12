/**
 * The question before switching a course's current edition, as a preview of
 * the change: one row per academic year it touches, newest first, its state
 * before and after as chips, the edition that becomes current and the one
 * that stops being, as GitHub shows the old and new default branch and
 * Vercel the deployment it promotes (outside the repository: their
 * documentation); the rule behind it is the hint under them. Not
 * destructive — switching back undoes it — so the confirming button is the
 * accent's.
 *
 * The page offers the switch only where `can_set_current` holds, so the
 * edition it replaces is one the caller sees, or there is none. A refusal the
 * server gives anyway stays in the dialog, the button left on to ask again:
 * the switch's own, `switch_needs_both`, when the edition being replaced is
 * out of the caller's reach; a missing permission; or a 404, which closes the
 * dialog and reads the page again.
 */

import { ArrowRight, CalendarCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type Edition, setCurrent } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Chip } from "@/components/ui/chip";
import { useFailure } from "./context";
import { isForbidden, isNotFound } from "./errors";
import { Forbidden } from "./Refusal";

interface SetCurrentDialogProps {
  /** The edition to make current; null while the dialog is closed. */
  edition: Edition | null;
  /** The course's current edition, among those the caller sees; null when it has none. */
  replaced: Edition | null;
  onClose: () => void;
  /** Reads the page again: every row's flags may have changed. */
  onChanged: () => Promise<unknown>;
  onCloseAutoFocus?: (event: Event) => void;
}

type Refusal = { kind: "forbidden" } | { kind: "said"; sentence: string };

export function SetCurrentDialog({
  edition,
  replaced,
  onClose,
  onChanged,
  onCloseAutoFocus,
}: SetCurrentDialogProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const confirm = async () => {
    if (edition === null) return false;
    setRefusal(null);
    try {
      await setCurrent(edition.id);
    } catch (error) {
      if (isNotFound(error)) {
        await onChanged();
        return true;
      }
      setRefusal(
        isForbidden(error) ? { kind: "forbidden" } : { kind: "said", sentence: fail(error) },
      );
      return false;
    }
    await onChanged();
    toast.success(t("staff.setCurrent.done"), {
      description: `${edition.course.name} · ${edition.academic_year}`,
    });
    return true;
  };

  // The years the switch touches, newest first, each with its state before it.
  const rows =
    edition === null
      ? []
      : [
          { year: edition.academic_year, before: false },
          ...(replaced === null ? [] : [{ year: replaced.academic_year, before: true }]),
        ].sort((a, b) => b.year.localeCompare(a.year));
  const state = (current: boolean) => (
    <Chip tone={current ? "accent" : "neutral"}>
      {current ? t("staff.current") : t("staff.past")}
    </Chip>
  );
  return (
    <AlertDialog
      open={edition !== null}
      onOpenChange={(open) => {
        if (open) return;
        setRefusal(null);
        onClose();
      }}
      heading={t("staff.setCurrent.title")}
      icon={CalendarCheck}
      description={edition === null ? "" : `${edition.course.name} · ${edition.course.code}`}
      cancelLabel={t("staff.cancel")}
      confirmLabel={t("staff.setCurrent.action")}
      onConfirm={confirm}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {edition !== null && (
        <div className="flex flex-col gap-tight">
          <ul aria-label={t("staff.setCurrent.preview")} className="flex flex-col gap-tight">
            {rows.map((row) => (
              <li
                key={row.year}
                className="flex flex-wrap items-center gap-tight rounded-control border border-line px-snug py-tight text-body text-ink tabular-nums"
              >
                <span className="min-w-0 flex-1 font-semibold">{row.year}</span>
                {state(row.before)}
                <ArrowRight aria-hidden className="size-icon text-muted" />
                <span className="sr-only">{t("staff.setCurrent.to")}</span>
                {state(!row.before)}
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted">{t("staff.setCurrent.caption")}</p>
        </div>
      )}
      {refusal?.kind === "forbidden" && <Forbidden permission="edition.set_current" />}
      {refusal?.kind === "said" && (
        <p
          role="alert"
          className="rounded-control border border-warn-line bg-warn px-snug py-tight text-body text-warn-ink"
        >
          {refusal.sentence}
        </p>
      )}
    </AlertDialog>
  );
}
