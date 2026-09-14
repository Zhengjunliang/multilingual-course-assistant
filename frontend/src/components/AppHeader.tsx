import { LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { UI_LOCALES, type UiLocale } from "@/i18n";
import { THEMES, type Theme } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  Theme,
  typeof Monitor
>;

interface AppHeaderProps {
  /** Only rendered on narrow screens, where the sidebar is a drawer. */
  onOpenSidebar: () => void;
}

export function AppHeader({ onOpenSidebar }: AppHeaderProps) {
  const { t, i18n } = useTranslation();
  const { account, logOut, chooseLocale } = useSession();
  const { theme, setTheme } = useTheme();

  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
  const ThemeIcon = THEME_ICONS[theme];

  return (
    <header className="flex flex-wrap items-center gap-snug border-line border-b bg-surface px-gutter py-snug">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label={t("sidebar.open")}
      >
        <Menu aria-hidden className="size-icon-lg" />
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold text-ink text-title">{t("app.title")}</h1>
      </div>

      {/* One primary weight on the page, and it is not here.
          Five controls of equal loudness — three languages, a theme, a way out —
          made the header compete with the answer for a reader's eye. The
          language in use is now marked by ink and a quiet fill rather than by
          the accent, which belongs to what a reader is about to *do*: the send
          button, a citation, the composer's border. */}
      <div className="flex gap-hair rounded-full bg-mark p-hair">
        {UI_LOCALES.map((locale: UiLocale) => {
          const active = i18n.language === locale;
          return (
            <Button
              key={locale}
              type="button"
              size="sm"
              // `outline` for the language in use and `ghost` for the others.
              // Not `default`: that variant is the accent, and the accent is
              // reserved for what a reader is about to do — send a question,
              // open a source — not for a setting that is merely already true.
              variant={active ? "outline" : "ghost"}
              aria-pressed={active}
              className="rounded-full"
              onClick={() => void chooseLocale(locale)}
            >
              {locale}
            </Button>
          );
        })}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setTheme(next)}
        aria-label={t(`theme.${theme}`)}
        title={t(`theme.${theme}`)}
      >
        <ThemeIcon aria-hidden className="size-icon-lg" />
      </Button>

      {account !== null && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void logOut()}
          aria-label={t("auth.logOut", { username: account.username })}
          title={t("auth.logOut", { username: account.username })}
        >
          <LogOut aria-hidden className="size-icon-lg" />
        </Button>
      )}
    </header>
  );
}
