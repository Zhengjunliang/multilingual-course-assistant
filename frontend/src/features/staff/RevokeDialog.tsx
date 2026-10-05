/**
 * Revoking a role, after one question that names who loses what.
 *
 * In the alert dialog with its confirming button in the `destructive`
 * variant, as deleting a conversation is: losing a role is undone only by
 * someone who may assign it again (docs/decisions.md, 2026-09-29, *The warning
 * hue also confirms destroying something, and the staff pages add components,
 * not tokens*), a deliberate departure from the prototype's plain button.
 * A 404 is a member already gone — revoked from another tab, the outcome
 * asked for — or a scope the reader lost meanwhile; the page reads again to
 * tell them apart, and only the first gets the toast that says it was done
 * elsewhere, while the second closes on the page's "not found".
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type MemberScope, removeMember } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useFailure } from "./context";
import { grantPermission, isForbidden, isNotFound } from "./errors";
import { Forbidden } from "./Refusal";

export interface Revoking {
  scope: MemberScope;
  username: string;
  /** What the role is held on, as the toast names it. */
  object: string;
  /** The question's body: who stops being what, and where. */
  sentence: string;
}

interface RevokeDialogProps {
  /** The role to revoke; null while the dialog is closed. */
  revoking: Revoking | null;
  onClose: () => void;
  /** Reads the page again, and resolves to whether it still could be read. */
  onChanged: () => Promise<boolean>;
  onCloseAutoFocus?: (event: Event) => void;
}

export function RevokeDialog({
  revoking,
  onClose,
  onChanged,
  onCloseAutoFocus,
}: RevokeDialogProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const confirm = async () => {
    if (revoking === null) return false;
    setRefusal(null);
    const done = (description: string) => {
      toast(t("staff.revoke.done"), { description });
      return true;
    };
    try {
      await removeMember(revoking.scope, revoking.username);
    } catch (error) {
      if (isNotFound(error)) {
        if (!(await onChanged())) return true;
        return done(t("staff.revoke.gone", { username: revoking.username }));
      }
      if (isForbidden(error)) setForbidden(true);
      else setRefusal(fail(error));
      return false;
    }
    await onChanged();
    return done(`${revoking.username} · ${revoking.object}`);
  };

  return (
    <AlertDialog
      open={revoking !== null}
      onOpenChange={(open) => {
        if (open) return;
        setForbidden(false);
        setRefusal(null);
        onClose();
      }}
      title={t("staff.revoke.title")}
      description={revoking?.sentence ?? ""}
      cancelLabel={t("staff.cancel")}
      confirmLabel={t("staff.revoke.action")}
      onConfirm={confirm}
      destructive
      confirmDisabled={forbidden}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {forbidden && revoking !== null && <Forbidden permission={grantPermission(revoking.scope)} />}
      {refusal !== null && (
        <p role="alert" className="text-body text-warn-ink">
          {refusal}
        </p>
      )}
    </AlertDialog>
  );
}
