/**
 * The question before switching a course's current edition, naming the
 * edition that becomes current and the one that stops being, as GitHub names
 * the old and new default branch and Vercel the deployment it promotes (outside
 * the repository: their documentation). Not destructive — switching back undoes
 * it — so the confirming button is the default ink.
 *
 * The page offers the switch only where `can_set_current` holds, so the
 * edition it replaces is one the caller sees, or there is none. A refusal the
 * server gives anyway stays in the dialog with the button off: the switch's
 * own, `switch_needs_both`, when the edition being replaced is out of the
 * caller's reach; a missing permission; or a 404, which closes the dialog and
 * reads the page again.
 */

import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type Edition, setCurrent } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
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
    toast(t("staff.setCurrent.done"), {
      description: `${edition.course.name} · ${edition.academic_year}`,
    });
    return true;
  };

  // Asking again would only be refused again: the button stays off until the dialog reopens.
  const blocked = refusal !== null;
  return (
    <AlertDialog
      open={edition !== null}
      onOpenChange={(open) => {
        if (open) return;
        setRefusal(null);
        onClose();
      }}
      title={t("staff.setCurrent.title")}
      description={edition?.course.name ?? ""}
      cancelLabel={t("staff.cancel")}
      confirmLabel={t("staff.setCurrent.action")}
      onConfirm={confirm}
      confirmDisabled={blocked}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {edition !== null && (
        <div className="flex flex-col gap-hair text-body text-ink">
          <p>
            {replaced === null ? (
              <Trans
                i18nKey="staff.setCurrent.becomes"
                values={{ year: edition.academic_year }}
                components={{ b: <strong /> }}
              />
            ) : (
              <Trans
                i18nKey="staff.setCurrent.switch"
                values={{ old: replaced.academic_year, new: edition.academic_year }}
                components={{ b: <strong /> }}
              />
            )}
          </p>
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
