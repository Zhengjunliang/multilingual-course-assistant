/**
 * The staff area's frame: its navigation, the status line, and the page.
 *
 * A layout of its own and not the chat's shell, whose sidebar holds the
 * reader's conversations and nothing else. Pages are objects — editions,
 * programmes — not roles: what a reader may do on each is read from the
 * server's rows. "Corsi di laurea" appears only to a caller who may view a
 * programme, and the admin, which the superuser alone may enter, is a plain
 * link: Django serves it, not this application.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router-dom";

import { listProgrammes } from "@/api/catalog";
import { useSession } from "@/auth/useSession";
import { AccountMenu } from "@/components/AccountMenu";
import { Status } from "@/components/ui/status";
import { StaffContext, useLoad } from "@/features/staff/context";
import { cn } from "@/lib/utils";

const ITEM = "rounded-md px-tight py-hair text-body transition-colors";

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    ITEM,
    isActive ? "bg-mark font-medium text-ink" : "text-muted hover:bg-mark hover:text-ink",
  );
}

export default function StaffLayout() {
  const { t } = useTranslation();
  const { account } = useSession();
  const [message, setMessage] = useState("");
  const programmes = useLoad(listProgrammes);
  const value = useMemo(() => ({ announce: setMessage }), []);

  return (
    <div className="min-h-full bg-canvas">
      <header className="border-line border-b bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-snug p-snug">
          <nav
            aria-label={t("staff.nav.label")}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-hair"
          >
            <NavLink to="/staff/editions" className={navClass}>
              {t("staff.nav.editions")}
            </NavLink>
            {(programmes.data?.length ?? 0) > 0 && (
              <NavLink to="/staff/programmes" className={navClass}>
                {t("staff.nav.programmes")}
              </NavLink>
            )}
            {account?.is_superuser && (
              <a href="/admin/" className={cn(ITEM, "text-muted hover:bg-mark hover:text-ink")}>
                {t("staff.nav.admin")}
              </a>
            )}
            <Link to="/" className={cn(ITEM, "text-muted hover:bg-mark hover:text-ink")}>
              {t("staff.nav.chat")}
            </Link>
          </nav>
          <AccountMenu />
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-gutter p-gutter">
        <Status message={message} />
        <StaffContext value={value}>
          <Outlet />
        </StaffContext>
      </main>
    </div>
  );
}
