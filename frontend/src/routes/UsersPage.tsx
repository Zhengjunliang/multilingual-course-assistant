/**
 * `/staff/users`: every account, for the superuser to find one and act on it
 * (#167): deactivate it or bring it back, sign it out everywhere, hand it a
 * link that sets its password, or delete it once deactivated; and, in a tab
 * of its own, every scope's invitations not accepted yet
 * (features/staff/Invitations.tsx), each revoked here or on its scope's
 * page. The site's door to what `/admin/` also does, through the same rules
 * (apps/accounts/manage_views.py; the row's menu, features/staff/AccountActions.tsx).
 *
 * Shaped as GitLab's list of users in its admin area (outside the
 * repository): the state as a toggle over the list, every account, the
 * active, the deactivated; a search by username; the server's pages
 * beneath, with the way to the one before and after; the rows are
 * features/staff/AccountTable.tsx's. The list stays shown while a search or
 * another page is read (`useLoad`'s `keep`); changing the search or the
 * state goes back to the first page, and a change that takes the last row
 * off a page goes back one.
 *
 * Anyone else in the staff area is told the page is not found, as at any
 * address under `/staff` with no page for them, and nothing is asked of the
 * server, which would refuse it.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { listUsers, USER_PAGE_SIZE } from "@/api/admin";
import { useSession } from "@/auth/useSession";
import { SearchField } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { type AccountChange, useAccountActions } from "@/features/staff/AccountActions";
import { AccountTable } from "@/features/staff/AccountTable";
import { useLoad } from "@/features/staff/context";
import { useInvitations } from "@/features/staff/Invitations";
import { PageHead, Pager } from "@/features/staff/page";
import { LoadFailure } from "@/features/staff/Refusal";
import { StaffNotFound } from "./StaffLanding";
import { useCrumbs, useShell } from "./shell";

type State = "all" | "active" | "inactive";

const ACTIVE: Record<State, boolean | null> = { all: null, active: true, inactive: false };

export default function UsersPage() {
  const { account } = useSession();
  if (account === null || !account.is_superuser) return <StaffNotFound />;
  return <Accounts self={account.id} />;
}

function Accounts({ self }: { self: number }) {
  const { t } = useTranslation();
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
  const invitations = useInvitations({
    scope: null,
    canInvite: false,
    object: "",
    reloadPage: users.reload,
  });
  useCrumbs({ kind: "users" });

  if (users.error !== null)
    return <LoadFailure error={users.error} back={back} onRetry={() => void users.reload()} />;
  if (users.data === null) return null;
  const { count } = users.data;

  return (
    <>
      <PageHead heading={t("staff.users.title")} />
      <Tabs
        label={t("staff.users.views")}
        defaultValue="accounts"
        tabs={[
          {
            value: "accounts",
            label: t("staff.users.title"),
            count,
            content: (
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
                <AccountTable users={shown} self={self} menu={actions.menu} />
                <Pager
                  page={page}
                  count={count}
                  size={USER_PAGE_SIZE}
                  previous={users.data.previous !== null}
                  next={users.data.next !== null}
                  onPage={setPage}
                />
              </div>
            ),
          },
          {
            value: "invitations",
            label: t("staff.invitations.title"),
            count: invitations.count,
            content: invitations.list,
          },
        ]}
      />
      {actions.dialogs}
      {invitations.dialogs}
    </>
  );
}
