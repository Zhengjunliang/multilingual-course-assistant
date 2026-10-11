import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";

import { ApiError } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@/i18n";
import { AuthButton, AuthFailure, AuthLayout } from "./AuthLayout";
import { useLanding } from "./landing";

/** The ids of the messages that describe each field, and of the form's own. */
const HINT = "password-hint";
const about = (field: string) => `${field}-refused`;
const FAILURE = "register-failure";

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { account, register } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const landing = useLanding("/");

  if (account !== null && landing.phase === "idle") return <Navigate to="/" replace />;

  // Whatever language they are reading this page in becomes the account's, so
  // the first answer arrives in it without a settings page being found first.
  const locale: UiLocale = isUiLocale(i18n.language) ? i18n.language : DEFAULT_UI_LOCALE;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    setFields({});
    await landing.send(
      () => register(username, password, locale),
      (error) => {
        if (error instanceof ApiError) {
          // Django's password validators say precisely what was wrong with a
          // password, and repeating that next to the field is the whole value
          // of having them; the password stays, since that is what they are
          // about. A 429 arrives as a detail with no fields.
          setFields(error.fields);
          if (Object.keys(error.fields).length === 0) setFailure(error.detail);
        } else {
          setFailure(t("auth.failed"));
        }
      },
    );
  };

  const messagesFor = (field: string) => fields[field] ?? [];
  const refused = (field: string) => messagesFor(field).length > 0;
  const messages = (field: string) =>
    refused(field) && (
      <div id={about(field)} className="flex flex-col gap-hair">
        {messagesFor(field).map((message) => (
          <AuthFailure key={message}>{message}</AuthFailure>
        ))}
      </div>
    );

  return (
    <AuthLayout
      heading={t("auth.registerTitle")}
      refusals={landing.refusals}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link to="/login" className="font-medium text-ink underline">
            {t("auth.logIn")}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-room" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-tight">
          <LineField
            id="username"
            label={t("auth.username")}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-invalid={refused("username") || undefined}
            aria-describedby={refused("username") ? about("username") : undefined}
          />
          {messages("username")}
        </div>

        <div className="flex flex-col gap-tight">
          <PasswordField
            id="password"
            label={t("auth.password")}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            invalid={refused("password")}
            describedBy={refused("password") ? `${HINT} ${about("password")}` : HINT}
          />
          <p id={HINT} className="text-caption text-muted">
            {t("auth.passwordHint")}
          </p>
          {messages("password")}
        </div>

        {failure !== null && <AuthFailure id={FAILURE}>{failure}</AuthFailure>}
        <AuthButton phase={landing.phase}>{t("auth.register")}</AuthButton>
      </form>
    </AuthLayout>
  );
}
