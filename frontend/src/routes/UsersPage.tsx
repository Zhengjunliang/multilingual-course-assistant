/**
 * `/staff/users`: every account, for the superuser to find one and act on it
 * (#167): deactivate it or bring it back, sign it out everywhere, hand it a
 * link that sets its password, or delete it once deactivated. The site's
 * door to what `/admin/` also does, through the same rules
 * (apps/accounts/manage_views.py; the row's menu, features/staff/AccountActions.tsx).
 *
 * Shaped as GitLab's list of users in its admin area (outside the
 * repository): the state as a toggle over the list, every account, the
 * active, the deactivated; a search by username; the server's pages
 * beneath, with the way to the one before and after. Each row is the
 * account, its username over the day it joined (DESIGN.md, rule 1), the
 * reader's own marked; its roles; its state; when it last signed in; and its
 * menu. The list stays shown while a search or another page is read
 * (`useLoad`'s `keep`); changing the search or the state goes back to the
 * first page, and a change that takes the last row off a page goes back one.
 *
 * Anyone else in the staff area is told the page is not found, as at any
 * address under `/staff` with no page for them, and nothing is asked of the
 * server, which would refuse it.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { listUsers, type ManagedUser, USER_PAGE_SIZE } from "@/api/admin";
import { useSession } from "@/auth/useSession";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SearchField } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { type AccountChange, useAccountActions } from "@/features/staff/AccountActions";
import { useLoad } from "@/features/staff/context";
import { PageHead } from "@/features/staff/page";
import { LoadFailure } from "@/features/staff/Refusal";
import { StaffNotFound } from "./StaffLanding";
import { useCrumbs, useShell } from "./shell";

type State = "all" | "active" | "inactive";

const ACTIVE: Record<State, boolean | null> = { all: null, active: true, inactive: false };

/** The roles a row names, each once, widest first, as auth/staff.ts orders them. */
function roleLabels(user: ManagedUser): ("admin" | "secretariat" | "teacher")[] {
  const held = new Set(user.roles.map((scope) => scope.role));
  return [
    ...(user.is_superuser ? (["admin"] as const) : []),
    ...(held.has("secretariat") ? (["secretariat"] as const) : []),
    ...(held.has("teacher") ? (["teacher"] as const) : []),
  ];
}

export default function UsersPage() {
  const { account } = useSession();
  if (account === null || !account.is_superuser) return <StaffNotFound />;
  return <Accounts self={account.id} />;
}

function Accounts({ self }: { self: number }) {
  const { t, i18n } = useTranslation();
  const { back } = useShell();
  const [state, setState] = useState<State>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const load = useCallback(
    () => listUsers({ q: query.trim(), active: ACTIVE[state], page }),
    [query, state, page],
  );
  const users = useLoad(load, { keep: true });
  const shown = users.data?.results ?? [];
  const actions = useAccountActions({
    self,
    onChanged: (change: AccountChange) => {
      // The row acted on leaves the list when it no longer matches the state shown.
      const leaves = change === "delete" || (state !== "all" && change !== "sessions");
      if (leaves && shown.length === 1 && page > 1) {
        setPage(page - 1);
        return Promise.resolve(true);
      }
      return users.reload();
    },
  });
  useCrumbs({ kind: "users" });

  if (users.error !== null)
    return <LoadFailure error={users.error} back={back} onRetry={() => void users.reload()} />;
  if (users.data === null) return null;
  const { count } = users.data;
  const pages = Math.max(1, Math.ceil(count / USER_PAGE_SIZE));
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHead
        heading={t("staff.users.title")}
        chips={<Chip tone="accent">{t("staff.users.count", { count })}</Chip>}
      />
      <div className="flex flex-col gap-snug">
        <div className="flex flex-wrap items-center gap-snug">
          <ToggleGroup
            label={t("staff.users.state")}
            value={state}
            onValueChange={(value: State) => {
              setState(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("staff.users.all") },
              { value: "active", label: t("staff.users.active") },
              { value: "inactive", label: t("staff.users.inactive") },
            ]}
          />
          <SearchField
            label={t("staff.users.searchLabel")}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("staff.users.search")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            className="min-w-0 flex-1 basis-56"
          />
        </div>
        {shown.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
            {t("staff.users.none")}
          </p>
        ) : (
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
              {shown.map((user) => {
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
                      {actions.menu(user)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <nav
            aria-label={t("staff.users.pages")}
            className="flex items-center justify-end gap-tight"
          >
            <span className="text-caption text-muted tabular-nums">
              {t("staff.users.page", { page, pages })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={users.data.previous === null}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft aria-hidden className="size-icon" />
              {t("staff.users.previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={users.data.next === null}
              onClick={() => setPage(page + 1)}
            >
              {t("staff.users.next")}
              <ChevronRight aria-hidden className="size-icon" />
            </Button>
          </nav>
        )}
      </div>
      {actions.dialogs}
    </>
  );
}
