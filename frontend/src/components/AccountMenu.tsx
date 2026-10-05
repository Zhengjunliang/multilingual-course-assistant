/**
 * The avatar in the corner, and everything that used to crowd the header.
 *
 * Five controls sat across the top of every screen — three languages, a theme,
 * a way out — each as loud as the title and none of them the thing a reader
 * came for. They are all here now, two clicks away, and the top of the screen
 * holds one letter in a circle.
 *
 * The dialog is opened from `onCloseAutoFocus` rather than from `onSelect`, and
 * that is not a flourish. Radix returns focus to the trigger as the menu
 * closes, and a dialog opened during `onSelect` is claiming focus at the same
 * moment: the two fight, and which one wins depends on timing. Waiting for the
 * menu to finish makes the order explicit.
 *
 * The superuser also finds the Django admin here, above "Esci": a plain page
 * load, since Django serves it and not this application. The staff pages are
 * not here: they are the sidebar's "Gestione" group.
 */

import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/auth/useSession";
import { AccountDialog } from "@/components/AccountDialog";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

export function AccountMenu() {
  const { t } = useTranslation();
  const { account, logOut } = useSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const wantsDialog = useRef(false);

  if (account === null) return null;

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

  return (
    <>
      <DropdownMenu
        ariaLabel={t("account.menu")}
        trigger={<Avatar name={account.username} />}
        label={account.username}
        onCloseAutoFocus={() => {
          if (!wantsDialog.current) return;
          wantsDialog.current = false;
          setDialogOpen(true);
        }}
        entries={[
          {
            key: "account",
            icon: UserRound,
            label: t("account.title"),
            onSelect: () => {
              wantsDialog.current = true;
            },
          },
          ...admin,
          {
            key: "logout",
            icon: LogOut,
            label: t("account.logOut"),
            onSelect: () => void logOut(),
          },
        ]}
      />
      <AccountDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
