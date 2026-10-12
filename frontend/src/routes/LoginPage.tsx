import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router-dom";

import { ApiError } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { FieldError } from "@/components/ui/field";
import { AuthButton, AuthLayout } from "./AuthLayout";
import { useLanding } from "./landing";

const FAILURE = "login-failure";

export default function LoginPage() {
  const { t } = useTranslation();
  const { account, logIn } = useSession();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

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

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    await landing.send(
      () => logIn(username, password),
      (error) => {
        // The server answers wrong password and unknown account identically on
        // purpose (apps/accounts/serializers.py); this shows whatever it said
        // and does not try to be more helpful than that. The password goes, as
        // the macOS sign-in window empties it.
        setFailure(error instanceof ApiError ? error.detail : t("auth.failed"));
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
        {failure !== null && <FieldError id={FAILURE}>{failure}</FieldError>}
        <AuthButton phase={landing.phase}>{t("auth.logIn")}</AuthButton>
      </form>
    </AuthLayout>
  );
}
