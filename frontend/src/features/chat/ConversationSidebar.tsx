/**
 * The sidebar of every signed-in page, direction A of the approved shell
 * (#191, after ChatGPT, Claude and Gemini): the brand, a new conversation as
 * its first row, the search, the staff pages, the conversations, and the
 * account at its foot.
 *
 * It stands on the page's own ground, the canvas and its grain, with one line
 * between it and the main area (ChatShell.tsx): one sheet of paper with a
 * fold in it rather than a grey column beside a white one.
 *
 * The new conversation is a link and not a button: it is a place, so it can
 * be opened in a new tab like any other. It is a row like the conversations
 * under it, told apart by its weight and by its icon in the accent, the one
 * action among places (DESIGN.md, "Shapes"), and its hint gives its key. The
 * search filters the titles already loaded, in the browser; it has no
 * request of its own. The collapse button shows while the pointer or the
 * focus is in the sidebar, always on a touch screen.
 *
 * One scroller holds the Gestione group and the conversations, as the
 * prototype has it: a long list scrolls the Gestione items away rather than
 * squeezing them. It is rendered in both places the sidebar appears, the
 * column on a wide screen and the drawer on a narrow one, and paints its own
 * ground for that reason, so the drawer stays a drawer that knows nothing
 * about what it holds.
 */

import { PanelLeft, SquarePen } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { ConversationSummary } from "@/api/conversations";
import { APP_NAME } from "@/brand/fumetto";
import { AccountMenu } from "@/components/AccountMenu";
import { MascotMark } from "@/components/Mascot";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ConversationList } from "./ConversationList";
import { SIDEBAR_ROW } from "./rows";
import { shortcuts } from "./shortcuts";

interface ConversationSidebarProps {
  /** `null` until the server has sent the list. */
  conversations: readonly ConversationSummary[] | null;
  /**
   * The conversation whose answer is queued, streaming or retrying; `null`
   * when nothing is being answered. It can be deleted all the same: the
   * confirmation says the answer stops, which it does when the layout leaves
   * the deleted conversation.
   */
  busy: number | null;
  /**
   * Deletes a conversation and resolves to whether the server did. The layout
   * route (routes/ShellLayout.tsx) owns the URL, so leaving a deleted
   * conversation is its job, not this one's.
   */
  onDelete: (id: number) => Promise<boolean>;
  /** Called after navigation so the narrow-screen drawer can close itself. */
  onNavigate?: () => void;
  /** Closes the wide-screen column. Absent on narrow screens, where the drawer wins. */
  onCollapse?: () => void;
  /** The shell's dialogs, which the account menu opens (ChatShell.tsx). */
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  /**
   * The staff pages the account may open (features/staff/ManagementNav.tsx),
   * above the conversations.
   */
  management?: ReactNode;
}

export function ConversationSidebar({
  conversations,
  busy,
  onDelete,
  onNavigate,
  onCollapse,
  onOpenSettings,
  onOpenHelp,
  management,
}: ConversationSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const newConversation = useRef<HTMLAnchorElement>(null);
  const keys = shortcuts();

  return (
    <div className="group/sidebar flex h-full min-h-0 flex-col gap-snug bg-ground p-snug">
      <div className="flex min-h-control items-center gap-tight">
        <MascotMark className="size-control-icon" />
        <p className="min-w-0 flex-1 truncate font-semibold text-ink text-title">{APP_NAME}</p>
        {/* Only from `lg` up: below that the sidebar is a drawer, and a drawer
            already closes by tapping outside it or pressing Escape. */}
        {onCollapse !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden shrink-0 transition-opacity lg:inline-flex pointer-fine:opacity-0 pointer-fine:focus-visible:opacity-100 pointer-fine:group-focus-within/sidebar:opacity-100 pointer-fine:group-hover/sidebar:opacity-100"
            onClick={onCollapse}
            aria-label={t("sidebar.collapse")}
          >
            <PanelLeft aria-hidden className="size-icon-lg" />
          </Button>
        )}
      </div>

      <Tooltip content={t("sidebar.new")} shortcut={keys.newConversation} side="right">
        <Link
          ref={newConversation}
          to="/"
          onClick={onNavigate}
          className={cn(SIDEBAR_ROW, "font-semibold")}
        >
          <SquarePen aria-hidden className="size-icon shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{t("sidebar.new")}</span>
        </Link>
      </Tooltip>

      <SearchField
        label={t("sidebar.search")}
        placeholder={t("sidebar.search")}
        shortcut={keys.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {/* A hairline between the two groups (DESIGN.md, rule 4). */}
      <div className="-mx-hair flex min-h-0 flex-1 flex-col gap-snug overflow-y-auto px-hair [&>nav+nav]:border-hairline [&>nav+nav]:border-t [&>nav+nav]:pt-snug">
        {management}
        <ConversationList
          conversations={conversations}
          query={query}
          busy={busy}
          onDelete={onDelete}
          onNavigate={onNavigate}
          focusAfterDelete={newConversation}
        />
      </div>

      <div className="border-line border-t pt-tight">
        <AccountMenu onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />
      </div>
    </div>
  );
}
