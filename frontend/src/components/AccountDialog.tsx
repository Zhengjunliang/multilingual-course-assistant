/**
 * Who is signed in, and the two settings that follow from that.
 *
 * It is called Account because that is the word on the menu item that opens it,
 * and because the reference interfaces use it. Only one of the three sections
 * is truly about the account, and the dialog says so rather than papering over
 * it: the language is written to `User.locale` and travels with the person,
 * while the theme lives in `localStorage` and belongs to the screen they happen
 * to be sitting at. `ThemeProvider` argues that distinction at length; the
 * caption under the theme row is where a reader is told about it.
 *
 * Logging out is here as well as in the menu. That is not two implementations
 * of one thing — it is one call rendered in the two places a reader looks for
 * it — but it is worth saying, because the menu can be closed and forgotten
 * while this dialog is the place someone opens when they are looking for
 * something.
 */

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { UI_LOCALES, type UiLocale } from "@/i18n";
import { THEMES, type Theme } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  Theme,
  typeof Monitor
>;

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-tight">
      <h3 className="font-medium text-caption text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
  const { t, i18n } = useTranslation();
  const { account, logOut, chooseLocale } = useSession();
  const { theme, setTheme } = useTheme();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("account.title")}
      closeLabel={t("account.close")}
    >
      <Section title={t("account.profile")}>
        <p className="text-body text-ink">{account?.username ?? ""}</p>
      </Section>

      <Section title={t("account.theme")}>
        <p className="text-caption text-muted">{t("account.themeCaption")}</p>
        <div className="flex flex-wrap gap-tight">
          {THEMES.map((option) => {
            const Icon = THEME_ICONS[option];
            // Outline for the one in use, ghost for the rest — never the
            // accent-filled variant. The accent marks what a reader is about to
            // do, not a setting that is already true. `LocaleSwitch` follows
            // the same rule one section below.
            return (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={theme === option ? "outline" : "ghost"}
                onClick={() => setTheme(option)}
              >
                <Icon aria-hidden className="size-icon" />
                {t(`theme.${option}`)}
              </Button>
            );
          })}
        </div>
      </Section>

      <Section title={t("account.language")}>
        <LocaleSwitch
          className="self-start"
          locales={UI_LOCALES}
          value={i18n.language}
          onChange={(locale: UiLocale) => void chooseLocale(locale)}
        />
      </Section>

      <Button type="button" variant="outline" className="self-start" onClick={() => void logOut()}>
        <LogOut aria-hidden className="size-icon" />
        {t("account.logOut")}
      </Button>
    </Dialog>
  );
}
