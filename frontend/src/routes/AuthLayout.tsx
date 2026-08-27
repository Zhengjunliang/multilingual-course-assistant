import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { UI_LOCALES } from "@/i18n";

/**
 * The frame around the two forms that come before a session.
 *
 * The language switch is here as well as in the application header, and it has
 * to be: before a login there is no account to read `User.locale` from, and a
 * student who cannot read the login page cannot get past it. This one changes
 * i18next only — there is nothing yet to save it to.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-semibold text-2xl text-ink">{t("app.title")}</h1>
          <p className="text-muted text-sm">{title}</p>
        </div>
        {children}
        <nav className="flex justify-center gap-1">
          {UI_LOCALES.map((locale) => (
            <Button
              key={locale}
              type="button"
              size="sm"
              variant={i18n.language === locale ? "default" : "outline"}
              onClick={() => void i18n.changeLanguage(locale)}
            >
              {locale}
            </Button>
          ))}
        </nav>
      </div>
    </div>
  );
}
