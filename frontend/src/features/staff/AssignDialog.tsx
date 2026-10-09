/**
 * Assigning a teacher to an edition, or secretariat staff to a programme, by
 * the username the person signs in with: there is no user search, so the one
 * field takes the exact name, and Enter submits it.
 *
 * The dialog stays open while the request runs and after a refusal. A refusal
 * of the name — no such user, already holding the role here — is shown at the
 * field. A missing permission is shown in the dialog, with the button off.
 * After any of them the field takes focus back: the button was off while the
 * request ran, and a browser drops the focus of a button that turns off to
 * the page, outside the dialog. A 404 means the scope left the caller's reach since
 * the page was read: the dialog closes and the page reads again, and says
 * "not found" if that is what it is now.
 */

import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { addMember, type MemberScope } from "@/api/catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFailure } from "./context";
import { fieldErrorKey, grantPermission, isForbidden, isNotFound } from "./errors";
import { Forbidden } from "./Refusal";

interface AssignDialogProps {
  /** Where to assign; null while the dialog is closed. */
  scope: MemberScope | null;
  /** What is assigned to, as the toast names it: an edition, or a programme's code. */
  object: string;
  /** The same, under the dialog's title. */
  description: string;
  onClose: () => void;
  /** Reads the page again after the assignment, or after the scope turned out gone. */
  onChanged: () => Promise<unknown>;
  onCloseAutoFocus?: (event: Event) => void;
}

export function AssignDialog({
  scope,
  object,
  description,
  onClose,
  onChanged,
  onCloseAutoFocus,
}: AssignDialogProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const fieldId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [running, setRunning] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const teacher = scope?.kind !== "programme";

  const close = () => {
    setUsername("");
    setFieldError(null);
    setForbidden(false);
    setRefusal(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim();
    if (scope === null || name === "" || running || forbidden) return;
    setRunning(true);
    setFieldError(null);
    setRefusal(null);
    try {
      const member = await addMember(scope, name);
      await onChanged();
      toast(t(teacher ? "staff.assign.doneTeacher" : "staff.assign.doneSecretariat"), {
        description: `${member.username} · ${object}`,
      });
      close();
    } catch (error) {
      const field = fieldErrorKey(error, "username");
      if (isNotFound(error)) {
        await onChanged();
        close();
        return;
      }
      if (field !== null) setFieldError(t(field));
      else if (isForbidden(error)) setForbidden(true);
      else setRefusal(fail(error));
      input.current?.focus();
    } finally {
      setRunning(false);
    }
  };

  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  return (
    <Dialog
      open={scope !== null}
      onOpenChange={(open) => {
        if (!open && !running) close();
      }}
      heading={t(teacher ? "staff.assign.teacher" : "staff.assign.secretariat")}
      description={description}
      closeLabel={t("staff.cancel")}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-room">
        <div className="flex flex-col gap-hair">
          <label htmlFor={fieldId} className="font-medium text-body text-ink">
            {t("staff.assign.username")}
          </label>
          <Input
            ref={input}
            id={fieldId}
            // Where a reader expects to type the moment the dialog opens.
            autoFocus
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setFieldError(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("staff.assign.placeholder")}
            aria-invalid={fieldError === null ? undefined : true}
            aria-describedby={fieldError === null ? hintId : `${errorId} ${hintId}`}
            className="font-mono"
          />
          <p id={hintId} className="text-caption text-muted">
            {t("staff.assign.hint")}
          </p>
          {fieldError !== null && (
            <p
              id={errorId}
              role="alert"
              className="flex items-center gap-tight text-caption text-warn-ink"
            >
              <CircleAlert aria-hidden className="size-icon shrink-0" />
              {fieldError}
            </p>
          )}
        </div>
        {forbidden && scope !== null && <Forbidden permission={grantPermission(scope)} />}
        {refusal !== null && (
          <p role="alert" className="text-body text-warn-ink">
            {refusal}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-tight">
          <Button type="button" variant="outline" onClick={close} disabled={running}>
            {t("staff.cancel")}
          </Button>
          <Button type="submit" disabled={running || forbidden || username.trim() === ""}>
            {running ? t("staff.assign.running") : t("staff.assign.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
