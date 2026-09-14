import { LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { LocaleSwitch } from "@/components/ui/locale-switch";
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

      {/* One primary weight on the page, and it is not here. Five controls of
          equal loudness — three languages, a theme, a way out — made the header
          compete with the answer for a reader's eye.

          The account is the source for the interface language (`User.locale`),
          so the choice is written there and comes back through the session. The
          login frame renders the same switch against i18next alone, because
          before a session there is nothing to write to. */}
      <LocaleSwitch
        locales={UI_LOCALES}
        value={i18n.language}
        onChange={(locale: UiLocale) => void chooseLocale(locale)}
      />

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
