import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router-dom";

import { ApiError } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthLayout } from "./AuthLayout";

export default function LoginPage() {
  const { t } = useTranslation();
  const { account, logIn } = useSession();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Wherever `RequireSession` sent this reader from, or the front page.
  const back = (location.state as { from?: string } | null)?.from ?? "/";
  if (account !== null) return <Navigate to={back} replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      await logIn(username, password);
    } catch (error) {
      // The server answers wrong password and unknown account identically on
      // purpose (apps/accounts/serializers.py); this shows whatever it said and
      // does not try to be more helpful than that.
      setFailure(error instanceof ApiError ? error.detail : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t("auth.logInTitle")}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-ink text-sm" htmlFor="username">
            {t("auth.username")}
          </label>
          <Input
            id="username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-ink text-sm" htmlFor="password">
            {t("auth.password")}
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {failure !== null && (
          <p className="rounded-md border border-warn-line bg-warn px-3 py-2 text-sm text-warn-ink">
            {failure}
          </p>
        )}

        <Button type="submit" disabled={busy}>
          {t("auth.logIn")}
        </Button>
      </form>

      <p className="text-center text-muted text-sm">
        {t("auth.noAccount")}{" "}
        <Link to="/register" className="text-ink underline">
          {t("auth.register")}
        </Link>
      </p>
    </AuthLayout>
  );
}
