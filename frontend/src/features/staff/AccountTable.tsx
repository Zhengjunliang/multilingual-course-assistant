/**
 * A page of accounts, as the superuser's page lists them (routes/UsersPage.tsx).
 *
 * Each row is the account, its username over the day it joined (DESIGN.md,
 * rule 1), the reader's own marked; its roles, each once, the widest first,
 * as auth/staff.ts orders them, and a student's when it holds none; whether
 * it may sign in; when it last did; and its menu (AccountActions.tsx), in a
 * cell that says which account it is, where the menu's dialogs find its
 * button again.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ManagedUser } from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** The roles a row names. */
function roleLabels(user: ManagedUser): ("admin" | "secretariat" | "teacher")[] {
  const held = new Set(user.roles.map((scope) => scope.role));
  return [
    ...(user.is_superuser ? (["admin"] as const) : []),
    ...(held.has("secretariat") ? (["secretariat"] as const) : []),
    ...(held.has("teacher") ? (["teacher"] as const) : []),
  ];
}

interface AccountTableProps {
  users: readonly ManagedUser[];
  /** The reader's own account. */
  self: number;
  /** The row's menu. */
  menu: (user: ManagedUser) => ReactNode;
}

export function AccountTable({ users, self, menu }: AccountTableProps) {
  const { t, i18n } = useTranslation();
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  if (users.length === 0)
    return (
      <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
        {t("staff.users.none")}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("staff.users.account")}</TableHead>
          <TableHead>{t("account.roles")}</TableHead>
          <TableHead>{t("staff.users.state")}</TableHead>
          <TableHead>{t("staff.users.lastLogin")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("staff.users.menu")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => {
          const roles = roleLabels(user);
          return (
            <TableRow key={user.id}>
              <TableCell>
                <span className="flex flex-wrap items-center gap-tight">
                  <span className="font-mono font-semibold">{user.username}</span>
                  {user.id === self && <Badge>{t("staff.you")}</Badge>}
                </span>
                <span className="block text-caption text-muted tabular-nums">
                  {t("staff.users.joined", { date: day.format(new Date(user.date_joined)) })}
                </span>
              </TableCell>
              <TableCell label={t("account.roles")}>
                <span className="flex flex-wrap gap-tight">
                  {roles.map((role) => (
                    <Chip key={role} tone="accent">
                      {t(`account.role.${role}`)}
                    </Chip>
                  ))}
                  {roles.length === 0 && <Chip>{t("account.role.student")}</Chip>}
                </span>
              </TableCell>
              <TableCell label={t("staff.users.state")}>
                <Chip tone={user.is_active ? "accent" : "neutral"}>
                  {t(user.is_active ? "staff.users.isActive" : "staff.users.isInactive")}
                </Chip>
              </TableCell>
              <TableCell
                label={t("staff.users.lastLogin")}
                className="whitespace-nowrap tabular-nums"
              >
                {user.last_login === null ? (
                  <span className="text-muted">{t("staff.users.never")}</span>
                ) : (
                  when.format(new Date(user.last_login))
                )}
              </TableCell>
              <TableCell data-account={user.id} className="text-right">
                {menu(user)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
