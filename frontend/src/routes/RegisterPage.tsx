import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";

import { useSession } from "@/auth/useSession";
import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { FieldError } from "@/components/ui/field";
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@/i18n";
import { describeError, type ErrorText } from "@/lib/errorText";
import { AuthButton, AuthLayout } from "./AuthLayout";
import { useLanding } from "./landing";

/** The ids of the messages that describe each field. */
const HINT = "password-hint";
const about = (field: string) => `${field}-refused`;
const FIELDS = ["username", "password"];

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { account, register } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const landing = useLanding("/");

  // A refusal that names fields puts the focus in the first of them, once
  // its messages describe it, as the login page puts it in its password. A
  // failure no field carries is an alert instead.
  useEffect(() => {
    const first = FIELDS.find((field) => (failure?.fieldSentences[field] ?? []).length > 0);
    if (first !== undefined) document.getElementById(first)?.focus();
  }, [failure]);

  if (account !== null && landing.phase === "idle") return <Navigate to="/" replace />;

  // Whatever language they are reading this page in becomes the account's, so
  // the first answer arrives in it without a settings page being found first.
  const locale: UiLocale = isUiLocale(i18n.language) ? i18n.language : DEFAULT_UI_LOCALE;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    await landing.send(
      () => register(username, password, locale),
      // Django's password validators say precisely what was wrong with a
      // password, and repeating that next to the field is the whole value of
      // having them; the password stays, since that is what they are about.
      (error) => setFailure(describeError(error, { shownFields: FIELDS })),
    );
  };

  // Rendered here rather than when the refusal arrived, so a change of
  // language rewords it.
  const sentencesFor = (field: string) => failure?.fieldSentences[field] ?? [];
  const refused = (field: string) => sentencesFor(field).length > 0;
  const messages = (field: string) =>
    refused(field) && (
      <div id={about(field)} className="flex flex-col gap-hair">
        {sentencesFor(field).map((sentence) => (
          <FieldError key={JSON.stringify(sentence)}>{t(sentence.key, sentence.values)}</FieldError>
        ))}
      </div>
    );
  // A refusal no field carries, a 429, is an alert; so is one to report,
  // whose code and request id no field's message has room for.
  const alert = failure !== null && (failure.reference !== null || !FIELDS.some(refused));

  return (
    <AuthLayout
      heading={t("auth.registerTitle")}
      refusals={landing.refusals}
      phase={landing.phase}
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

        {alert && (
          <FieldError
            role="alert"
            reference={
              failure.reference ? t(failure.reference.key, failure.reference.values) : undefined
            }
          >
            {t(failure.sentence.key, failure.sentence.values)}
          </FieldError>
        )}
        <AuthButton phase={landing.phase}>{t("auth.register")}</AuthButton>
      </form>
    </AuthLayout>
  );
}
