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
    <header className="flex flex-wrap items-center gap-3 border-line border-b bg-surface px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label={t("sidebar.open")}
      >
        <Menu aria-hidden className="h-5 w-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold text-ink">{t("app.title")}</h1>
      </div>

      {/* The account is the source for the interface language (User.locale), so
          switching writes there and the answer comes back through the session. */}
      <div className="flex gap-1">
        {UI_LOCALES.map((locale: UiLocale) => (
          <Button
            key={locale}
            type="button"
            size="sm"
            variant={i18n.language === locale ? "default" : "outline"}
            onClick={() => void chooseLocale(locale)}
          >
            {locale}
          </Button>
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setTheme(next)}
        aria-label={t(`theme.${theme}`)}
        title={t(`theme.${theme}`)}
      >
        <ThemeIcon aria-hidden className="h-5 w-5" />
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
          <LogOut aria-hidden className="h-5 w-5" />
        </Button>
      )}
    </header>
  );
}
