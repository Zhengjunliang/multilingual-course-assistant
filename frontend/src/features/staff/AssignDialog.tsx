/**
 * Assigning a teacher to an edition, or secretariat staff to a programme, by
 * the username the person signs in with: there is no user search, so the one
 * field takes the exact name, and Enter submits it.
 *
 * Its head names the object, the course and its year or the programme, and
 * its button shows its key and, while the request is on its way, its
 * spinner. The button is never off to say why it cannot act (DESIGN.md, Do's
 * and Don'ts): an empty name is refused under the field when it is pressed,
 * and a missing permission is said under the field too, pressing again
 * asking the server again, which is the one that knows.
 *
 * The dialog stays open while the request runs and after a refusal. A refusal
 * of the name — no such user, already holding the role here — is shown at the
 * field. After any refusal the field takes focus back: the button was off
 * while the request ran, and a browser drops the focus of a button that turns
 * off to the page, outside the dialog. A 404 means the scope left the
 * caller's reach since the page was read: the dialog closes and the page
 * reads again, and says "not found" if that is what it is now.
 */

import { UserPlus } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { addMember, type MemberScope } from "@/api/catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import type { ErrorText, Sentence } from "@/lib/errorText";
import { useFailure } from "./context";
import { grantPermission, isForbidden, isHeldAlready, isNotFound } from "./errors";
import { shownName } from "./people";
import { Forbidden, WriteFailure } from "./Refusal";

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
  const [fieldError, setFieldError] = useState<Sentence | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<ErrorText | null>(null);
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
    if (scope === null || running) return;
    if (name === "") {
      setFieldError({ key: "staff.assign.empty", values: {} });
      input.current?.focus();
      return;
    }
    setRunning(true);
    setFieldError(null);
    setForbidden(false);
    setRefusal(null);
    try {
      const member = await addMember(scope, name);
      await onChanged();
      toast.success(t(teacher ? "staff.assign.doneTeacher" : "staff.assign.doneSecretariat"), {
        description: `${shownName(member)} · ${object}`,
      });
      close();
    } catch (error) {
      if (isNotFound(error)) {
        await onChanged();
        close();
        return;
      }
      const said = fail(error, { shownFields: ["username"] });
      const atName = isHeldAlready(error) ? said.sentence : said.fieldSentences.username?.[0];
      if (atName !== undefined) setFieldError(atName);
      else if (isForbidden(error)) setForbidden(true);
      else setRefusal(said);
      input.current?.focus();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={scope !== null}
      onOpenChange={(open) => {
        if (!open && !running) close();
      }}
      heading={t(teacher ? "staff.assign.teacher" : "staff.assign.secretariat")}
      description={description}
      icon={UserPlus}
      closeLabel={t("staff.cancel")}
      onCloseAutoFocus={onCloseAutoFocus}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} disabled={running}>
            {t("staff.cancel")}
          </Button>
          <Button
            type="submit"
            pending={running}
            shortcut={{ keys: "Enter", label: t("keys.enter") }}
          >
            {running ? t("staff.assign.running") : t("staff.assign.submit")}
          </Button>
        </>
      }
    >
      <Field
        ref={input}
        id={fieldId}
        label={t("staff.assign.username")}
        hint={t("staff.assign.hint")}
        error={fieldError === null ? undefined : t(fieldError.key, fieldError.values)}
        announce
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
        className="font-mono"
      />
      {forbidden && scope !== null && <Forbidden permission={grantPermission(scope)} />}
      {refusal !== null && <WriteFailure text={refusal} />}
    </Dialog>
  );
}
