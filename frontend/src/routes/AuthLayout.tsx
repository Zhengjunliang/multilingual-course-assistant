import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { UI_LOCALES, type UiLocale } from "@/i18n";

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
    <div className="flex min-h-full flex-col items-center justify-center gap-room px-gutter py-room">
      <div className="flex w-full max-w-sm flex-col gap-room">
        <div className="flex flex-col gap-hair text-center">
          <h1 className="font-semibold text-display text-ink">{t("app.title")}</h1>
          <p className="text-body text-muted">{title}</p>
        </div>
        {children}
        <LocaleSwitch
          className="self-center"
          locales={UI_LOCALES}
          value={i18n.language}
          onChange={(locale: UiLocale) => void i18n.changeLanguage(locale)}
        />
      </div>
    </div>
  );
}
