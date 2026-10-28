/**
 * The account's password, changed by giving the current one (ASVS 6.2.2 and
 * 6.2.3): the new one is held to the registration's rules, and once it is
 * set every other session of the account has ended (apps/accounts/self_views.py),
 * which the toast says and the list of devices then shows.
 *
 * A wrong current password is said under it, and it empties, as the login
 * page's does; a refused new one under the new one, which stays. The form
 * carries the account's username, unseen, so a password manager files the
 * new password under it (Chromium's "Create amazing password forms",
 * outside the repository).
 */

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { changePassword } from "@/api/account";
import { ApiError } from "@/api/http";
import { useFormRefusal } from "@/components/FormRefusal";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { useFailure } from "@/features/staff/context";
import type { ErrorText } from "@/lib/errorText";

const HINT = "new-password-hint";
const FIELDS = ["password", "new_password"];

interface PasswordChangeProps {
  username: string;
  /** Reads the account's sessions again, which the change ended but this one. */
  onChanged: () => void;
}

export function PasswordChange({ username, onChanged }: PasswordChangeProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const refusal = useFormRefusal(failure, FIELDS);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setFailure(null);
    try {
      await changePassword(password, next);
      setPassword("");
      setNext("");
      toast.success(t("account.password.done"), { description: t("account.password.ended") });
      onChanged();
    } catch (error) {
      const said = fail(error, { shownFields: FIELDS });
      if (error instanceof ApiError && error.code === "WRONG_CREDENTIALS") {
        setPassword("");
        setFailure({
          ...said,
          fieldSentences: { password: [{ key: "account.wrongPassword", values: {} }] },
        });
      } else setFailure(said);
    } finally {
      setRunning(false);
    }
  };

  return (
    <form className="flex max-w-md flex-col gap-room" onSubmit={(event) => void submit(event)}>
      <input hidden readOnly autoComplete="username" value={username} />
      <div className="flex flex-col gap-tight">
        <PasswordField
          id="password"
          label={t("auth.currentPassword")}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={refusal.refused("password")}
          describedBy={refusal.describedBy("password")}
        />
        {refusal.lines("password")}
      </div>
      <div className="flex flex-col gap-tight">
        <PasswordField
          id="new_password"
          label={t("auth.newPassword")}
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          invalid={refusal.refused("new_password")}
          describedBy={refusal.describedBy("new_password", HINT)}
        />
        <p id={HINT} className="text-caption text-muted">
          {t("auth.passwordHint")}
        </p>
        {refusal.lines("new_password")}
      </div>
      {refusal.alert}
      <Button type="submit" className="self-start" pending={running}>
        {t("account.password.submit")}
      </Button>
    </form>
  );
}
