/**
 * The front page's frame for a reader who is not signed in: the chat, and the
 * way to an account above it.
 *
 * No sidebar. A visitor has no stored conversation to list and no staff page
 * to open, and the page is the functional minimum: how a visitor's frame
 * should look, and what it should say about what an account adds, is the
 * front-end design's question, `#136`.
 *
 * It hands the chat the same `Shell` the signed-in frame does
 * (routes/shell.ts), with nothing behind the calls a visitor's chat makes:
 * there is no list of conversations to refresh and no row to protect from
 * deletion. The staff fields are never read here; `RequireSession` lets a
 * visitor onto `/` alone.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router-dom";

import { buttonVariants } from "@/components/ui/button";
import { type Shell, ShellContext } from "./shell";

const nothing = () => {};

export default function VisitorLayout() {
  const { t } = useTranslation();
  const homeLabel = t("staff.refusal.home");

  const shell = useMemo<Shell>(
    () => ({
      programmes: null,
      programmesError: null,
      landing: null,
      root: null,
      back: { to: "/", label: homeLabel },
      setCrumbs: nothing,
      refreshConversations: nothing,
      setBusy: nothing,
      setStop: nothing,
    }),
    [homeLabel],
  );

  return (
    <ShellContext value={shell}>
      <div className="flex h-full min-w-0 flex-col">
        {/* The signed-in header's row (features/chat/ChatShell.tsx), with the
            two ways in where the account menu would be. */}
        <header className="flex shrink-0 items-center justify-end gap-snug px-gutter py-snug">
          <Link to="/login" className={buttonVariants({ variant: "ghost" })}>
            {t("auth.logIn")}
          </Link>
          <Link to="/register" className={buttonVariants()}>
            {t("auth.register")}
          </Link>
        </header>
        <Outlet />
      </div>
    </ShellContext>
  );
}
