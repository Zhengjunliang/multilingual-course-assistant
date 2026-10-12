/**
 * The account at the foot of the sidebar: who is signed in, and the menu of
 * everything that belongs to them rather than to a conversation (#191).
 *
 * At the foot because that is where ChatGPT, Claude and Gemini keep it, so the
 * top of the main area holds nothing but where the reader is. The row shows
 * the avatar, the name and the account's widest role on a chip
 * (auth/staff.ts, `roleOf`), and the menu opens above it with the same three
 * at its head. Then the language, at the first level and showing the one in
 * use, since it is the setting a reader of three languages changes most, and
 * choosing one writes it to the account (`User.locale`) as well as the
 * interface; the settings, which hold the theme alone; the list of shortcuts;
 * the Django admin for the superuser, a plain page load since Django serves
 * it; and signing out. The staff pages are not here: they are the sidebar's
 * «Gestione» group.
 *
 * A dialog is opened from `onCloseAutoFocus` rather than from `onSelect`, and
 * that is not a flourish. Radix returns focus to the trigger as the menu
 * closes, and a dialog opened during `onSelect` is claiming focus at the same
 * moment: the two fight, and which one wins depends on timing. Waiting for the
 * menu to finish makes the order explicit, and the dialog then returns the
 * focus to this row when it closes. The dialogs themselves belong to the
 * shell (features/chat/ChatShell.tsx), which opens them from the keyboard too.
 */

import {
  ChevronsUpDown,
  Globe,
  Keyboard,
  LogOut,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/account";
import { roleOf } from "@/auth/staff";
import { useSession } from "@/auth/useSession";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { shortcuts } from "@/features/chat/shortcuts";
import { endonym, isUiLocale, languageCode, UI_LOCALES } from "@/i18n";

interface AccountMenuProps {
  /**
   * The sidebar's row, with the menu above it, or the folded rail's avatar
   * alone, with the same menu at its right.
   */
  variant?: "row" | "avatar";
  /** In the narrow drawer, where the language opens in place rather than to the side. */
  inline?: boolean;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

function Identity({ account }: { account: Account }) {
  const { t } = useTranslation();
  const role = roleOf(account);
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start gap-hair">
      <span className="max-w-full truncate font-semibold text-body text-ink">
        {account.username}
      </span>
      <Chip tone={role === "student" ? "neutral" : "accent"}>{t(`account.role.${role}`)}</Chip>
    </span>
  );
}

const ROW =
  "flex w-full items-center gap-tight rounded-card border border-transparent p-hair text-left transition-colors hover:border-line hover:bg-surface hover:shadow-raised focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 data-[state=open]:border-line data-[state=open]:bg-surface data-[state=open]:shadow-raised";

export function AccountMenu({
  variant = "row",
  inline = false,
  onOpenSettings,
  onOpenHelp,
}: AccountMenuProps) {
  const { t, i18n } = useTranslation();
  const { account, logOut, chooseLocale } = useSession();
  const after = useRef<(() => void) | null>(null);

  if (account === null) return null;

  const keys = shortcuts();
  const admin = account.is_superuser
    ? [
        {
          key: "admin",
          icon: ShieldCheck,
          label: t("account.admin"),
          onSelect: () => window.location.assign("/admin/"),
        },
      ]
    : [];

  const row = variant === "row";
  return (
    <DropdownMenu
      trigger={
        row ? (
          <>
            <Avatar name={account.username} />
            <Identity account={account} />
            <ChevronsUpDown aria-hidden className="size-icon shrink-0 text-muted" />
          </>
        ) : (
          <Avatar name={account.username} />
        )
      }
      // The row names itself with the name and the role it shows; the avatar
      // alone shows only initials, so it carries a name of its own.
      ariaLabel={row ? undefined : t("account.menu")}
      hint={row ? undefined : t("account.menu")}
      triggerClassName={row ? ROW : undefined}
      side={row ? "top" : "right"}
      align={row ? "start" : "end"}
      fitTrigger={row}
      inline={inline}
      head={
        <span className="flex items-center gap-tight">
          <Avatar name={account.username} />
          <Identity account={account} />
        </span>
      }
      onCloseAutoFocus={() => {
        const open = after.current;
        after.current = null;
        open?.();
      }}
      sections={[
        {
          key: "preferences",
          items: [
            {
              key: "language",
              icon: Globe,
              label: t("account.language"),
              value: i18n.language,
              options: UI_LOCALES.map((locale) => ({
                value: locale,
                label: endonym(locale),
                lang: locale,
                code: languageCode(locale),
              })),
              onValueChange: (locale) => {
                if (isUiLocale(locale)) void chooseLocale(locale);
              },
            },
            {
              key: "settings",
              icon: SlidersHorizontal,
              label: t("account.settingsItem"),
              shortcut: keys.settings,
              onSelect: () => {
                after.current = onOpenSettings;
              },
            },
          ],
        },
        {
          key: "help",
          items: [
            {
              key: "help",
              icon: Keyboard,
              label: t("account.help"),
              shortcut: keys.help,
              onSelect: () => {
                after.current = onOpenHelp;
              },
            },
            ...admin,
          ],
        },
        {
          key: "session",
          items: [
            {
              key: "logout",
              icon: LogOut,
              label: t("account.logOut"),
              onSelect: () => void logOut(),
            },
          ],
        },
      ]}
    />
  );
}
