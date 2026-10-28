import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router-dom";

import { useSession } from "@/auth/useSession";
import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { FieldError } from "@/components/ui/field";
import { describeError, type ErrorText } from "@/lib/errorText";
import { AuthButton, AuthLayout } from "./AuthLayout";
import { useLanding } from "./landing";

const FAILURE = "login-failure";
const FIELDS = ["username", "password"];

export default function LoginPage() {
  const { t } = useTranslation();
  const { account, logIn } = useSession();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ErrorText | null>(null);

  // Wherever `RequireSession` sent this reader from, or the front page.
  const back = (location.state as { from?: string } | null)?.from ?? "/";
  const landing = useLanding(back);

  // The focus goes back to the emptied password after a refusal, once the
  // field is marked invalid and described by the failure, and only on this
  // page: a refusal arriving after the reader has gone on to another form
  // leaves its fields alone.
  useEffect(() => {
    if (landing.refusals > 0) document.getElementById("password")?.focus();
  }, [landing.refusals]);

  if (account !== null && landing.phase === "idle") return <Navigate to={back} replace />;

  // One line under the password says it all: a field's own words where the
  // server named a field, else the sentence for the whole request. Rendered
  // here rather than when it arrived, so a change of language rewords it.
  const said = failure && (Object.values(failure.fieldSentences).flat()[0] ?? failure.sentence);
  const reference = failure?.reference;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    await landing.send(
      () => logIn(username, password),
      (error) => {
        // The server answers wrong password and unknown account identically on
        // purpose (apps/accounts/serializers.py); this says what it said and
        // does not try to be more helpful than that. The password goes, as the
        // macOS sign-in window empties it.
        setFailure(describeError(error, { shownFields: FIELDS }));
        setPassword("");
      },
    );
  };

  return (
    <AuthLayout
      heading={t("auth.logInTitle")}
      refusals={landing.refusals}
      phase={landing.phase}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="font-medium text-ink underline">
            {t("auth.register")}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-room" onSubmit={(event) => void onSubmit(event)}>
        <LineField
          id="username"
          label={t("auth.username")}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            setFailure(null);
          }}
        />
        <PasswordField
          id="password"
          label={t("auth.password")}
          autoComplete="current-password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setFailure(null);
          }}
          invalid={failure !== null}
          describedBy={failure !== null ? FAILURE : undefined}
        />
        {said !== null && (
          <FieldError
            id={FAILURE}
            reference={reference ? t(reference.key, reference.values) : undefined}
          >
            {t(said.key, said.values)}
          </FieldError>
        )}
        <Link to="/forgot" className="self-end text-caption text-muted underline">
          {t("auth.forgot")}
        </Link>
        <AuthButton phase={landing.phase}>{t("auth.logIn")}</AuthButton>
      </form>
    </AuthLayout>
  );
}
