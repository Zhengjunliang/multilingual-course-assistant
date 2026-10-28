/**
 * What a superuser does to an account from its row of `/staff/users`
 * (routes/UsersPage.tsx), wired as `useMembers` wires a scope's members
 * (actions.tsx): the hook holds the dialogs' state and returns the row's
 * menu and the dialogs themselves.
 *
 * The menu offers what would change the account now, under the server's
 * rules (apps/accounts/services.py): an active account is deactivated or
 * signed out everywhere, a deactivated one reactivated or, last and apart,
 * deleted, and either is given a reset link. The reader's own row has no
 * menu: the server refuses each of these on the caller's own account, which
 * changes itself on its own page. Reactivating only gives back, so it is
 * done at once; deactivating, signing out and deleting ask first, in the
 * alert dialog, deleting in the warning's tint (RevokeDialog.tsx). A reset
 * link is made at once and shown the one time it exists (OneTimeLink.tsx).
 *
 * A dialog opens once the menu has closed, as the account menu opens its own
 * (components/AccountMenu.tsx), and gives the focus back to the row's menu
 * button or, when the row has left the list, to the next row's, the one
 * before, or the page's heading. An account deleted elsewhere before the
 * request arrived is read again and said in a toast; a rule the server holds
 * to says why in the dialog, or, for an action that asked nothing, in a toast.
 */

import {
  Ellipsis,
  KeyRound,
  LogOut,
  type LucideIcon,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  activateUser,
  deactivateUser,
  deleteUser,
  endUserSessions,
  type ManagedUser,
  makeResetLink,
} from "@/api/admin";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import type { ErrorText } from "@/lib/errorText";
import { focusBack, returnFocus } from "./actions";
import { useFailure } from "./context";
import { isNotFound } from "./errors";
import { OneTimeLink, type Shown } from "./OneTimeLink";
import { WriteFailure } from "./Refusal";

/** The changes asked about first, each with its icon and its request. */
const ASKED = {
  deactivate: { icon: UserX, run: deactivateUser },
  sessions: { icon: LogOut, run: endUserSessions },
  delete: { icon: Trash2, run: deleteUser },
} as const;

type Asked = keyof typeof ASKED;
export type AccountChange = Asked | "activate";

const MENU = '[aria-haspopup="menu"]';
/** Every row's menu button, in the list's order; a row says which account it is (`data-account`). */
const MENUS = `main [data-account] ${MENU}`;

interface AccountActionsOptions {
  /** The reader's own account, whose row offers nothing. */
  self: number;
  /** Reads the list again after `change`. */
  onChanged: (change: AccountChange) => Promise<unknown>;
}

interface AccountActions {
  /** The row's menu, or null on the reader's own row. */
  menu: (user: ManagedUser) => ReactNode;
  dialogs: ReactNode;
}

export function useAccountActions({ self, onChanged }: AccountActionsOptions): AccountActions {
  const { t } = useTranslation();
  const fail = useFailure();
  const [asking, setAsking] = useState<{ change: Asked; user: ManagedUser } | null>(null);
  const [link, setLink] = useState<{ user: ManagedUser; shown: Shown } | null>(null);
  const [refusal, setRefusal] = useState<ErrorText | null>(null);
  // What the menu chose, run once it has closed.
  const after = useRef<(() => void) | null>(null);
  // Read when the row may have left the list.
  const last = useRef<{ trigger?: HTMLElement; index: number }>({ index: 0 });

  const fallbacks = () => {
    const left = document.querySelectorAll(MENUS);
    const { index } = last.current;
    return [left[index], left[index - 1]];
  };
  const toRow = returnFocus(() => last.current.trigger, fallbacks);

  const gone = async (user: ManagedUser) => {
    await onChanged("delete");
    toast(t("staff.users.gone", { username: user.username }));
  };

  const confirm = async () => {
    if (asking === null) return false;
    const { change, user } = asking;
    setRefusal(null);
    try {
      await ASKED[change].run(user.id);
    } catch (error) {
      if (isNotFound(error)) {
        await gone(user);
        return true;
      }
      setRefusal(fail(error));
      return false;
    }
    await onChanged(change);
    toast.success(t(`staff.users.${change}.done`), { description: user.username });
    return true;
  };

  /** An action that asks nothing first: reactivating, or making a reset link. */
  const now = async (user: ManagedUser, action: "activate" | "link") => {
    try {
      if (action === "link") {
        const made = await makeResetLink(user.id);
        setLink({ user, shown: { path: "/reset", ...made } });
      } else {
        await activateUser(user.id);
        await onChanged("activate");
        toast.success(t("staff.users.activate.done"), { description: user.username });
      }
    } catch (error) {
      if (isNotFound(error)) await gone(user);
      else {
        const { sentence } = fail(error);
        toast.error(t("staff.users.failed"), { description: t(sentence.key, sentence.values) });
      }
    }
    // A reactivated account leaves the list of the deactivated, its menu button with it.
    if (last.current.trigger?.isConnected !== true) focusBack(undefined, fallbacks());
  };

  /** The menu item's `onSelect`: notes the row's button, and runs `then` once the menu has closed. */
  const choose = (user: ManagedUser, then: () => void) => () => {
    const menus = [...document.querySelectorAll<HTMLElement>(MENUS)];
    const trigger = menus.find((button) => button.closest(`[data-account="${user.id}"]`) !== null);
    last.current = { trigger, index: trigger === undefined ? 0 : menus.indexOf(trigger) };
    after.current = then;
  };

  const menu = (user: ManagedUser) => {
    if (user.id === self) return null;
    const item = (key: AccountChange | "link", icon: LucideIcon, then: () => void) => ({
      key,
      icon,
      label: t(`staff.users.${key}.action`),
      onSelect: choose(user, then),
    });
    const ask = (change: Asked) =>
      item(change, ASKED[change].icon, () => setAsking({ change, user }));
    const resetLink = item("link", KeyRound, () => void now(user, "link"));
    const sections = user.is_active
      ? [{ key: "change", items: [ask("deactivate"), ask("sessions"), resetLink] }]
      : [
          {
            key: "change",
            items: [item("activate", UserCheck, () => void now(user, "activate")), resetLink],
          },
          { key: "delete", items: [ask("delete")] },
        ];
    return (
      <DropdownMenu
        trigger={<Ellipsis aria-hidden className="size-icon" />}
        triggerClassName={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        ariaLabel={t("staff.users.actions", { username: user.username })}
        onCloseAutoFocus={() => {
          const open = after.current;
          after.current = null;
          open?.();
        }}
        sections={sections}
      />
    );
  };

  const dialogs = (
    <>
      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRefusal(null);
          setAsking(null);
        }}
        heading={asking === null ? "" : t(`staff.users.${asking.change}.title`)}
        icon={asking === null ? undefined : ASKED[asking.change].icon}
        description={
          asking === null ? (
            ""
          ) : (
            <Trans
              i18nKey={`staff.users.${asking.change}.body`}
              values={{ username: asking.user.username }}
              components={{ person: <Chip className="font-mono" /> }}
            />
          )
        }
        cancelLabel={t("staff.cancel")}
        confirmLabel={asking === null ? "" : t(`staff.users.${asking.change}.action`)}
        onConfirm={confirm}
        destructive={asking?.change === "delete"}
        onCloseAutoFocus={toRow}
      >
        {refusal !== null && <WriteFailure text={refusal} />}
      </AlertDialog>
      <OneTimeLink
        shown={link?.shown ?? null}
        heading={t("staff.users.link.title")}
        description={link?.user.username ?? ""}
        onClose={() => setLink(null)}
        onCloseAutoFocus={toRow}
      />
    </>
  );
  return { menu, dialogs };
}
