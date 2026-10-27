/**
 * Revoking a role, after one question that names who loses what: the
 * person, and the course and year or the programme, each a chip (DESIGN.md,
 * the alert dialog), as GitHub's dialog for removing a collaborator names
 * the person and the repository.
 *
 * In the alert dialog with its confirming button in the `destructive`
 * variant, its icon repeated on it, as deleting a conversation is: losing a
 * role is undone only by someone who may assign it again, so the
 * confirmation wears the hue kept for what cannot be taken back: an
 * accent-filled "Revoca" would look like the safe choice. A refusal leaves
 * the button on, and pressing it again asks again.
 * A 404 is a member already gone — revoked from another tab, the outcome
 * asked for — or a scope the reader lost meanwhile; the page reads again to
 * tell them apart, and only the first gets the toast that says it was done
 * elsewhere, while the second closes on the page's "not found".
 */

import { UserMinus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type MemberScope, removeMember } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import type { ErrorText } from "@/lib/errorText";
import { useFailure } from "./context";
import { grantPermission, isForbidden, isNotFound } from "./errors";
import { Forbidden, WriteFailure } from "./Refusal";

export interface Revoking {
  scope: MemberScope;
  username: string;
  /** The person as the page shows them: their name, or their username. */
  shown: string;
  /** What the role is held on, as the toast names it. */
  object: string;
  /** The question's body: who stops being what, and where, its objects as chips. */
  sentence: ReactNode;
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
  const [refusal, setRefusal] = useState<ErrorText | null>(null);

  const confirm = async () => {
    if (revoking === null) return false;
    setForbidden(false);
    setRefusal(null);
    const done = (description: string) => {
      toast.success(t("staff.revoke.done"), { description });
      return true;
    };
    try {
      await removeMember(revoking.scope, revoking.username);
    } catch (error) {
      if (isNotFound(error)) {
        if (!(await onChanged())) return true;
        return done(t("staff.revoke.gone", { username: revoking.shown }));
      }
      if (isForbidden(error)) setForbidden(true);
      else setRefusal(fail(error));
      return false;
    }
    await onChanged();
    return done(`${revoking.shown} · ${revoking.object}`);
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
      heading={t("staff.revoke.title")}
      icon={UserMinus}
      description={revoking?.sentence ?? ""}
      cancelLabel={t("staff.cancel")}
      confirmLabel={t("staff.revoke.action")}
      onConfirm={confirm}
      destructive
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {forbidden && revoking !== null && <Forbidden permission={grantPermission(revoking.scope)} />}
      {refusal !== null && <WriteFailure text={refusal} />}
    </AlertDialog>
  );
}
