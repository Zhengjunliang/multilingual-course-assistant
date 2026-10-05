/**
 * The frame every signed-in page shares: the chat shell, its sidebar of
 * conversations and Gestione items, and the header with the breadcrumb and
 * the account; the page itself is the `<Outlet>`.
 *
 * A layout route (React Router's own pattern) rather than a shell each page
 * renders for itself: the sidebar is wired once, so moving between the chat
 * and a staff page neither fetches the conversations again nor flashes an
 * empty list. The conversations, deleting one, and the conversation being
 * answered live here for that reason; the chat reports the last of these
 * (routes/shell.ts). Leaving the chat unmounts it, which stops an answer
 * being written (features/chat/useAsk.ts), as leaving for any other page did.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useMatch, useNavigate } from "react-router-dom";

import { listProgrammes, type Programme } from "@/api/catalog";
import { isRefusal } from "@/api/client";
import type { ConversationSummary } from "@/api/conversations";
import { deleteConversation, listConversations } from "@/api/conversations";
import { ApiError } from "@/api/http";
import { isStaff } from "@/auth/staff";
import { useSession } from "@/auth/useSession";
import { AccountMenu } from "@/components/AccountMenu";
import { Breadcrumb, type Crumb } from "@/components/ui/breadcrumb";
import { ChatShell, type SidebarControls } from "@/features/chat/ChatShell";
import { ConversationSidebar } from "@/features/chat/ConversationSidebar";
import { isSessionLost } from "@/features/staff/errors";
import { managementItems } from "@/features/staff/landing";
import { ManagementNav } from "@/features/staff/ManagementNav";
import { type Shell, ShellContext } from "./shell";

export default function ShellLayout() {
  const { t } = useTranslation();
  const { account, forget } = useSession();
  const navigate = useNavigate();
  const open = useMatch("/c/:conversationId")?.params.conversationId;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<readonly Crumb[]>([]);
  const [programmes, setProgrammes] = useState<{ data: Programme[] | null; error: unknown }>({
    data: null,
    error: null,
  });

  const refused = useCallback(
    (error: unknown) => {
      // A session that ended somewhere else surfaces as a 403 on the next
      // call; dropping the account is what puts the login page in front.
      if (isRefusal(error)) forget();
    },
    [forget],
  );

  const refreshConversations = useCallback(() => {
    listConversations()
      .then(setConversations)
      .catch((error: unknown) => refused(error));
  }, [refused]);

  useEffect(refreshConversations, [refreshConversations]);

  // Only staff have programmes to read: a student's sidebar asks for none.
  const staff = account !== null && isStaff(account);
  useEffect(() => {
    if (!staff) return;
    let live = true;
    listProgrammes().then(
      (data) => {
        if (live) setProgrammes({ data, error: null });
      },
      (error: unknown) => {
        if (!live) return;
        if (isSessionLost(error)) forget();
        setProgrammes({ data: null, error });
      },
    );
    return () => {
      live = false;
    };
  }, [staff, forget]);

  // Leaving a deleted conversation is decided here, where the list is, and
  // only once the server has said it is gone: navigating first would show an
  // empty page for a conversation that may still exist. `replace` so the back
  // button does not lead to it.
  const onDelete = useCallback(
    async (id: number) => {
      try {
        await deleteConversation(id);
      } catch (error) {
        // A 404 is a conversation already gone — deleted from another tab —
        // which is the outcome that was asked for.
        const gone = error instanceof ApiError && error.status === 404;
        if (!gone) {
          refused(error);
          refreshConversations();
          return false;
        }
      }
      if (open === String(id)) void navigate("/", { replace: true });
      refreshConversations();
      return true;
    },
    [open, navigate, refreshConversations, refused],
  );

  const items = useMemo(
    () => (account === null ? [] : managementItems(account, programmes.data)),
    [account, programmes.data],
  );
  const homeLabel = t("staff.refusal.home");
  const shell = useMemo<Shell>(
    () => ({
      programmes: programmes.data,
      programmesError: programmes.error,
      landing: items[0]?.to ?? null,
      root: items[0]?.key ?? null,
      back: { to: items[0]?.to ?? "/", label: homeLabel },
      setCrumbs,
      refreshConversations,
      setBusy,
    }),
    [programmes, items, homeLabel, refreshConversations],
  );

  const sidebar = ({ onNavigate, onCollapse }: SidebarControls) => (
    <ConversationSidebar
      conversations={conversations}
      busy={busy}
      onDelete={onDelete}
      onNavigate={onNavigate}
      onCollapse={onCollapse}
      management={
        items.length > 0 ? <ManagementNav items={items} onNavigate={onNavigate} /> : undefined
      }
    />
  );

  return (
    <ShellContext value={shell}>
      <ChatShell
        sidebar={sidebar}
        leading={
          crumbs.length > 0 ? <Breadcrumb label={t("staff.breadcrumb")} crumbs={crumbs} /> : null
        }
        controls={<AccountMenu />}
      >
        <Outlet />
      </ChatShell>
    </ShellContext>
  );
}
