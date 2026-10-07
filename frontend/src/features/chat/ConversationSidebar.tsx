import { MessageSquarePlus, PanelLeft, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import type { ConversationSummary } from "@/api/conversations";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  conversations: readonly ConversationSummary[];
  /**
   * The conversation whose answer is queued, streaming or retrying, which
   * cannot be deleted until it settles; `null` when nothing is being answered.
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
  /**
   * The staff pages the account may open (features/staff/ManagementNav.tsx),
   * above the conversations, which then take a heading of their own.
   */
  management?: ReactNode;
}

export function ConversationSidebar({
  conversations,
  busy,
  onDelete,
  onNavigate,
  onCollapse,
  management,
}: ConversationSidebarProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ConversationSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const titleOf = (conversation: ConversationSummary) =>
    conversation.title || t("sidebar.untitled");

  const close = () => {
    setPending(null);
    setFailed(false);
  };

  // The delete button the dialog was opened from, and the link focus falls
  // back to once a deletion has taken that button's row away. Radix returns
  // focus only to a `Trigger` of its own, which this dialog, opened from
  // state, does not have.
  const askedFrom = useRef<HTMLElement | null>(null);
  const newConversation = useRef<HTMLAnchorElement>(null);

  const ask = (conversation: ConversationSummary, from: HTMLElement) => {
    askedFrom.current = from;
    setFailed(false);
    setPending(conversation);
  };

  // The dialog stays open until the server has answered, and cannot be
  // dismissed meanwhile (ui/alert-dialog.tsx): closing it first would say
  // "deleted" about a conversation that may still be there.
  const confirm = async () => {
    if (pending === null) return false;
    setFailed(false);
    const deleted = await onDelete(pending.id);
    setFailed(!deleted);
    return deleted;
  };

  return (
    // Its own colour, and the reason is that it is rendered in two places: the
    // fixed column on a wide screen and the drawer on a narrow one. Painting
    // the containers instead would mean painting two of them, and one of those
    // is a generic drawer that also holds unrelated things.
    <div className="flex h-full min-h-0 flex-col gap-snug bg-sidebar p-snug">
      {/* The name of the application lives here now. There is no header bar to
          hold it, which is the trade the reference interfaces make: the title
          is where the product's own furniture is, and the reading column starts
          at the top of the screen. */}
      <div className="flex items-center gap-tight">
        <p className="min-w-0 flex-1 truncate px-tight py-tight font-semibold font-serif text-ink text-title">
          {t("app.title")}
        </p>
        {/* Only from `lg` up: below that the sidebar is a drawer, and a drawer
            already closes by tapping outside it or pressing Escape. */}
        {onCollapse !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden shrink-0 lg:inline-flex"
            onClick={onCollapse}
            aria-label={t("sidebar.collapse")}
          >
            <PanelLeft aria-hidden className="size-icon-lg" />
          </Button>
        )}
      </div>

      {/* A link and not a button: "new conversation" is a place, so it should
          be openable in a new tab like any other.

          No fill of its own. On this palette `--surface` is *darker* than
          `--sidebar` in the dark theme, so a filled button here would read as a
          dent rather than a control. The border carries it, and the hover fill
          is the same `--mark` the conversation rows use. */}
      <NavLink
        ref={newConversation}
        to="/"
        end
        onClick={onNavigate}
        className="flex h-control w-full items-center justify-center gap-tight rounded-md border border-line font-medium text-body text-ink transition-colors hover:bg-mark"
      >
        <MessageSquarePlus aria-hidden className="size-icon" />
        {t("sidebar.new")}
      </NavLink>

      {/* One scroller for both groups, as the prototype has it: a long list of
          conversations scrolls the Gestione items away rather than squeezing
          them. */}
      <div className="flex min-h-0 flex-1 flex-col gap-snug overflow-y-auto">
        {management}
        <nav aria-label={t("sidebar.title")} className="flex flex-col gap-hair">
          {management !== undefined && (
            <p className="px-tight pt-tight font-medium text-caption text-muted">
              {t("sidebar.title")}
            </p>
          )}
          {conversations.length === 0 ? (
            <p className="px-tight py-gutter text-body text-muted">{t("sidebar.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-hair">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="group flex items-center gap-hair">
                  <NavLink
                    to={`/c/${conversation.id}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "block min-w-0 flex-1 truncate rounded-md px-tight py-tight text-body transition-colors",
                        // The open conversation is where the reader *is*, not
                        // something they are about to do: ink and a quiet fill,
                        // the same rule the language switch follows.
                        isActive
                          ? "bg-mark font-medium text-ink"
                          : "text-muted hover:bg-mark hover:text-ink",
                      )
                    }
                  >
                    {titleOf(conversation)}
                  </NavLink>
                  {/* Shown on hover or focus where there is a fine pointer to
                    hover with; always on a touch screen, whatever its width.
                    Disabled while this conversation's answer is being written:
                    the question would be refused and the half answer lost. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 pointer-fine:opacity-0 pointer-fine:focus-visible:opacity-100 pointer-fine:group-hover:opacity-100"
                    aria-label={t("sidebar.delete", { title: titleOf(conversation) })}
                    title={busy === conversation.id ? t("sidebar.deleteBusy") : undefined}
                    disabled={busy === conversation.id}
                    onClick={(event) => ask(conversation, event.currentTarget)}
                  >
                    <Trash2 aria-hidden className="size-icon" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t("sidebar.deleteTitle")}
        description={pending === null ? "" : t("sidebar.deleteBody", { title: titleOf(pending) })}
        cancelLabel={t("sidebar.cancel")}
        confirmLabel={t("sidebar.deleteConfirm")}
        onConfirm={confirm}
        destructive
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const back = askedFrom.current?.isConnected ? askedFrom.current : newConversation.current;
          back?.focus();
        }}
      >
        {failed && (
          <p
            role="alert"
            className="rounded-md border border-warn-line bg-warn px-snug py-tight text-body text-warn-ink"
          >
            {t("sidebar.deleteFailed")}
          </p>
        )}
      </AlertDialog>
    </div>
  );
}
