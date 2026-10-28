/**
 * The password asked again before an action on the account's own sessions
 * or on the account itself (apps/accounts/reauth.py), as GitHub asks for it
 * before a sensitive change (outside the repository: GitHub's "sudo mode").
 *
 * A form dialog (DESIGN.md, Components): the field takes the focus as it
 * opens, Enter sends it, and the dialog stays open while the request runs
 * and after a refusal. A wrong password is said under the field, which
 * empties and takes the focus back, as the login page's does; any other
 * refusal, the account's rules included, above the buttons. An action that
 * destroys something takes the warning's tint, on the disc and the button.
 */

import type { LucideIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "@/api/http";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { useFailure } from "@/features/staff/context";
import { WriteFailure } from "@/features/staff/Refusal";
import type { ErrorText } from "@/lib/errorText";

const FIELD = "reauth-password";
const WRONG = `${FIELD}-refused`;

interface PasswordDialogProps {
  open: boolean;
  heading: string;
  /** What the action is done to, under the heading. */
  description?: string;
  icon: LucideIcon;
  confirmLabel: string;
  warn?: boolean;
  /** Does the action with the password; rejects with what the server refused. */
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
  /** What the action does that its heading cannot say, above the field. */
  children?: ReactNode;
}

export function PasswordDialog({
  open,
  heading,
  description,
  icon,
  confirmLabel,
  warn = false,
  onConfirm,
  onClose,
  children,
}: PasswordDialogProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [refusal, setRefusal] = useState<ErrorText | null>(null);

  const close = () => {
    setPassword("");
    setWrong(false);
    setRefusal(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setWrong(false);
    setRefusal(null);
    try {
      await onConfirm(password);
      close();
    } catch (error) {
      const said = fail(error);
      if (error instanceof ApiError && error.code === "WRONG_CREDENTIALS") {
        setWrong(true);
        setPassword("");
      } else setRefusal(said);
      document.getElementById(FIELD)?.focus();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !running) close();
      }}
      heading={heading}
      description={description}
      icon={icon}
      warn={warn}
      closeLabel={t("staff.cancel")}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} disabled={running}>
            {t("staff.cancel")}
          </Button>
          <Button
            type="submit"
            variant={warn ? "warn" : "primary"}
            pending={running}
            shortcut={{ keys: "Enter", label: t("keys.enter") }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <div className="flex flex-col gap-tight">
        <PasswordField
          id={FIELD}
          label={t("auth.password")}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(value) => {
            setPassword(value);
            setWrong(false);
          }}
          invalid={wrong}
          describedBy={wrong ? WRONG : undefined}
        />
        {wrong && <FieldError id={WRONG}>{t("account.wrongPassword")}</FieldError>}
      </div>
      {refusal !== null && <WriteFailure text={refusal} />}
    </Dialog>
  );
}
