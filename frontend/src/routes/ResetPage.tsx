import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { lookUpResetLink, resetPassword } from "@/api/account";
import { useFormRefusal } from "@/components/FormRefusal";
import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { describeError, type ErrorText } from "@/lib/errorText";
import { AuthButton, AuthLayout } from "./AuthLayout";
import { useLanding } from "./landing";
import { isDeadLink, LinkFailure, useLink } from "./link";

const HINT = "password-hint";
const FIELDS = ["new_password"];

/**
 * `/reset#<token>`: a new password, through the one-time link the superuser
 * handed over (routes/link.tsx). The page names the account the link resets,
 * in a read-only username field so a password manager files the new
 * password under it. The password is held to the registration's rules, and
 * one refused leaves the link working. Once it is set every session of the
 * account has ended and none has begun (OWASP Forgot Password Cheat Sheet,
 * outside the repository), so the page goes on to the login.
 */
export default function ResetPage() {
  const { t } = useTranslation();
  const link = useLink(lookUpResetLink);
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const landing = useLanding("/login");
  const refusal = useFormRefusal(failure, FIELDS);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    await landing.send(
      () => resetPassword(link.token, password),
      (error) => {
        if (isDeadLink(error)) link.died();
        else setFailure(describeError(error, { shownFields: FIELDS }));
      },
    );
  };

  return (
    <AuthLayout
      heading={t("auth.resetTitle")}
      refusals={landing.refusals}
      phase={landing.phase}
      footer={
        <Link to="/login" className="font-medium text-ink underline">
          {t("auth.backToLogIn")}
        </Link>
      }
    >
      {link.failure !== null && <LinkFailure failure={link.failure} />}
      {link.target !== null && (
        <form className="flex flex-col gap-room" onSubmit={(event) => void onSubmit(event)}>
          <LineField
            id="username"
            label={t("auth.username")}
            autoComplete="username"
            readOnly
            value={link.target.username}
          />
          <div className="flex flex-col gap-tight">
            <PasswordField
              id="new_password"
              label={t("auth.newPassword")}
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              invalid={refusal.refused("new_password")}
              describedBy={refusal.describedBy("new_password", HINT)}
            />
            <p id={HINT} className="text-caption text-muted">
              {t("auth.passwordHint")}
            </p>
            {refusal.lines("new_password")}
          </div>
          {refusal.alert}
          <AuthButton phase={landing.phase}>{t("auth.resetSubmit")}</AuthButton>
        </form>
      )}
    </AuthLayout>
  );
}
