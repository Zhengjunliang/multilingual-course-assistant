import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { APP_NAME } from "@/brand/fumetto";
import { LivingMascot } from "@/components/LivingMascot";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { chooseUiLocale, UI_LOCALES, type UiLocale } from "@/i18n";

/**
 * The frame around the two forms that come before a session.
 *
 * The language switch is here as well as in the application header, and it has
 * to be: before a login there is no account to read `User.locale` from, and a
 * student who cannot read the login page cannot get past it. This one
 * remembers the choice on this screen only (i18n/index.ts): there is no
 * account yet to save it to.
 *
 * The cat above the form is the entry's (#173), alive and as large, with no
 * intro: the sign-in screens are the entry's other door. Its eyes follow the
 * field being typed in.
 */
export function AuthLayout({ heading, children }: { heading: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-room px-gutter py-room">
      <div className="flex w-full max-w-sm flex-col gap-room">
        <div className="flex flex-col items-center gap-hair text-center">
          <LivingMascot className="w-entry-cat-sm md:w-entry-cat" />
          <h1 className="font-semibold font-serif text-display text-ink">{APP_NAME}</h1>
          <p className="text-body text-muted">{heading}</p>
        </div>
        {children}
        <LocaleSwitch
          className="self-center"
          locales={UI_LOCALES}
          value={i18n.language}
          label={t("account.language")}
          onChange={(locale: UiLocale) => void chooseUiLocale(locale)}
        />
      </div>
    </div>
  );
}
