/**
 * The question before switching a course's current edition, naming both the
 * edition that becomes current and the one that stops being, as GitHub names
 * the old and new default branch and Vercel the deployment it promotes (outside
 * the repository: their documentation). Not destructive — switching back undoes
 * it — so the confirming button is the default ink. A refusal the server gives
 * anyway, such as a switch another tab made first, is shown in the dialog.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { type Edition, setCurrent } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useFailure, useStaff } from "./context";

interface SetCurrentDialogProps {
  /** The edition to make current; null when the dialog is closed. */
  edition: Edition | null;
  /** The course's current edition, when the caller can see it. */
  replaced: Edition | null;
  onClose: () => void;
  /** After a switch: every row's flags may have changed, so the list is read again. */
  onSwitched: () => void;
}

export function SetCurrentDialog({
  edition,
  replaced,
  onClose,
  onSwitched,
}: SetCurrentDialogProps) {
  const { t } = useTranslation();
  const { announce } = useStaff();
  const fail = useFailure();
  const [refusal, setRefusal] = useState<string | null>(null);

  const names = {
    course: edition === null ? "" : `${edition.course.code} ${edition.course.name}`,
    new: edition?.academic_year ?? "",
    old: replaced?.academic_year ?? "",
  };

  const confirm = async () => {
    if (edition === null) return false;
    try {
      await setCurrent(edition.id);
    } catch (error) {
      setRefusal(fail(error));
      return false;
    }
    announce(t("staff.setCurrent.done", names));
    onSwitched();
    return true;
  };

  return (
    <AlertDialog
      open={edition !== null}
      onOpenChange={(open) => {
        if (open) return;
        setRefusal(null);
        onClose();
      }}
      title={t("staff.setCurrent.title", names)}
      description={t(
        replaced === null ? "staff.setCurrent.bodyAlone" : "staff.setCurrent.body",
        names,
      )}
      cancelLabel={t("staff.cancel")}
      confirmLabel={t("staff.setCurrent.confirm")}
      onConfirm={confirm}
    >
      {refusal !== null && <p className="text-body text-warn-ink">{refusal}</p>}
    </AlertDialog>
  );
}
