import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router-dom";

import { ApiError } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { AuthButton, AuthFailure, AuthLayout } from "./AuthLayout";
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
        // the macOS sign-in window empties it, and the focus is put back there.
        setFailure(error instanceof ApiError ? error.detail : t("auth.failed"));
        setPassword("");
        document.getElementById("password")?.focus();
      },
    );
  };

  return (
    <AuthLayout
      heading={t("auth.logInTitle")}
      refusals={landing.refusals}
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
        {failure !== null && <AuthFailure id={FAILURE}>{failure}</AuthFailure>}
        <AuthButton phase={landing.phase}>{t("auth.logIn")}</AuthButton>
      </form>
    </AuthLayout>
  );
}
