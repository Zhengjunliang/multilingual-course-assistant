/**
 * The settings: the theme, and nothing else (#191).
 *
 * The theme alone because it is the one setting that belongs to the screen
 * rather than to the person: it lives in `localStorage`, and `ThemeProvider`
 * argues that at length; the caption under it tells the reader. The language
 * is the person's (`User.locale`) and sits one level up, in the account menu,
 * where ChatGPT and Claude put it too; a line here says so, for a reader who
 * came looking for it, and says what it does not change.
 *
 * Opened from the account menu's «Impostazioni…» and from Ctrl , anywhere
 * (features/chat/shortcuts.ts).
 */

import { Monitor, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Dialog } from "@/components/ui/dialog";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { THEMES, type Theme } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  Theme,
  typeof Monitor
>;

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes back to: the dialog is opened from state, so Radix has no trigger to return it to. */
  onCloseAutoFocus?: (event: Event) => void;
}

export function SettingsDialog({ open, onOpenChange, onCloseAutoFocus }: SettingsDialogProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      heading={t("account.settings")}
      icon={SlidersHorizontal}
      closeLabel={t("account.close")}
    >
      <section className="flex flex-col gap-tight">
        <h3 className="font-semibold text-caption text-muted uppercase">{t("account.theme")}</h3>
        <p className="text-caption text-muted">{t("account.themeCaption")}</p>
        <ToggleGroup
          className="self-start"
          label={t("account.theme")}
          value={theme}
          onValueChange={setTheme}
          options={THEMES.map((option) => ({
            value: option,
            label: t(`theme.${option}`),
            icon: THEME_ICONS[option],
          }))}
        />
      </section>
      <p className="text-caption text-muted">
        {t("account.languageInMenu")} {t("account.languageHint")}
      </p>
    </Dialog>
  );
}
