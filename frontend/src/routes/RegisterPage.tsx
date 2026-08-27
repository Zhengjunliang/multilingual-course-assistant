import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";

import { ApiError } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UI_LOCALES, type UiLocale } from "@/i18n";
import { AuthLayout } from "./AuthLayout";

function isUiLocale(value: string): value is UiLocale {
  return (UI_LOCALES as readonly string[]).includes(value);
}

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { account, register } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  if (account !== null) return <Navigate to="/" replace />;

  // Whatever language they are reading this page in becomes the account's, so
  // the first answer arrives in it without a settings page being found first.
  const locale: UiLocale = isUiLocale(i18n.language) ? i18n.language : "it";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    setFields({});
    setBusy(true);
    try {
      await register(username, password, locale);
    } catch (error) {
      if (error instanceof ApiError) {
        // Django's password validators say precisely what was wrong with a
        // password, and repeating that next to the field is the whole value of
        // having them. A 429 arrives as a detail with no fields.
        setFields(error.fields);
        if (Object.keys(error.fields).length === 0) setFailure(error.detail);
      } else {
        setFailure(t("auth.failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const messagesFor = (field: string) => fields[field] ?? [];

  return (
    <AuthLayout title={t("auth.registerTitle")}>
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
          {messagesFor("username").map((message) => (
            <p key={message} className="text-sm text-warn-ink">
              {message}
            </p>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-medium text-ink text-sm" htmlFor="password">
            {t("auth.password")}
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {messagesFor("password").map((message) => (
            <p key={message} className="text-sm text-warn-ink">
              {message}
            </p>
          ))}
        </div>

        {failure !== null && (
          <p className="rounded-md border border-warn-line bg-warn px-3 py-2 text-sm text-warn-ink">
            {failure}
          </p>
        )}

        <Button type="submit" disabled={busy}>
          {t("auth.register")}
        </Button>
      </form>

      <p className="text-center text-muted text-sm">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="text-ink underline">
          {t("auth.logIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}
