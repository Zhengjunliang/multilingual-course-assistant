/**
 * The sidebar's «Recenti»: the reader's conversations, newest first, under a
 * heading that counts them (#191).
 *
 * A row is the title and, at its right, when the conversation started
 * (rows.ts). Under the pointer or the focus the delete button takes the
 * time's place, as ChatGPT's row actions do; on a touch screen, which has no
 * pointer to rest, it is always there and the time is not. The open
 * conversation is drawn as where the reader is (rows.ts, `SIDEBAR_ROW_CURRENT`).
 *
 * Three states before the rows, and they are not one: `null` is a list still
 * on its way, three skeleton rows; an empty list is the server saying there
 * is nothing, the sleeping cat's panel with no button, since the question box
 * beside it is the way on; and a search that finds nothing says so in one
 * line. Showing the empty panel while the list loads would tell every reader
 * with conversations that they have none, for as long as the request takes.
 *
 * Deleting asks first, and the dialog stays open until the server has
 * answered and cannot be dismissed meanwhile (ui/alert-dialog.tsx): closing it
 * first would say "deleted" about a conversation that may still be there.
 * Never disabled, not even while this conversation's answer is being written:
 * the confirmation says that answer stops (DESIGN.md, "Do's and Don'ts").
 */

import { Trash2 } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import type { ConversationSummary } from "@/api/conversations";
import { Mascot } from "@/components/Mascot";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Count } from "@/components/ui/count";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SIDEBAR_ROW, SIDEBAR_ROW_CURRENT, startedLabel, titleMatches } from "./rows";

interface ConversationListProps {
  /** `null` until the server has sent the list. */
  conversations: readonly ConversationSummary[] | null;
  /** What the search field holds; the rows are the titles that contain it. */
  query: string;
  /** The conversation being answered, whose deletion stops its answer. */
  busy: number | null;
  /** Resolves to whether the server deleted it (routes/ShellLayout.tsx leaves it). */
  onDelete: (id: number) => Promise<boolean>;
  onNavigate?: () => void;
  /** Where focus goes once a deletion has taken the button it was on away. */
  focusAfterDelete: RefObject<HTMLElement | null>;
}

const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"];

export function ConversationList({
  conversations,
  query,
  busy,
  onDelete,
  onNavigate,
  focusAfterDelete,
}: ConversationListProps) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<ConversationSummary | null>(null);
  const [failed, setFailed] = useState(false);
  // The delete button the dialog was opened from. Radix returns focus only to
  // a `Trigger` of its own, which this dialog, opened from state, does not have.
  const askedFrom = useRef<HTMLElement | null>(null);

  const titleOf = (conversation: ConversationSummary) =>
    conversation.title || t("sidebar.untitled");

  const shown = (conversations ?? []).filter((conversation) =>
    titleMatches(titleOf(conversation), query, i18n.language),
  );

  const confirm = async () => {
    if (pending === null) return false;
    setFailed(false);
    const deleted = await onDelete(pending.id);
    setFailed(!deleted);
    return deleted;
  };

  // The dialog is outside the list, so deleting the last conversation, which
  // swaps the list for the empty panel, does not take the dialog with it
  // before it has given the focus back.
  const list =
    conversations !== null && conversations.length === 0 ? (
      <Empty
        visual={<Mascot pose="sleep" className="size-control" />}
        heading={t("sidebar.emptyTitle")}
      >
        {t("sidebar.emptyBody")}
      </Empty>
    ) : (
      <nav aria-label={t("sidebar.recent")} className="flex flex-col gap-hair">
        <h2 className="flex items-center gap-tight px-tight pt-hair font-semibold text-body text-ink">
          {t("sidebar.recent")}
          {conversations !== null && <Count value={shown.length} className="ml-auto" />}
        </h2>
        {conversations === null ? (
          <div role="status" aria-label={t("sidebar.loading")} className="flex flex-col gap-hair">
            {SKELETON_WIDTHS.map((width) => (
              <div key={width} className="flex min-h-control-sm items-center px-tight">
                <Skeleton className={width} />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-tight py-tight text-body text-muted">{t("sidebar.noMatch")}</p>
        ) : (
          <ul className="flex flex-col gap-hair">
            {shown.map((conversation) => (
              <li key={conversation.id} className="group relative">
                <NavLink
                  to={`/c/${conversation.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(SIDEBAR_ROW, "font-medium", isActive && SIDEBAR_ROW_CURRENT)
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{titleOf(conversation)}</span>
                  <time
                    dateTime={conversation.created_at}
                    className="shrink-0 font-normal text-caption text-muted tabular-nums pointer-coarse:invisible pointer-fine:group-focus-within:invisible pointer-fine:group-hover:invisible"
                  >
                    {startedLabel(conversation.created_at, i18n.language)}
                  </time>
                </NavLink>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-hair -translate-y-1/2 pointer-fine:opacity-0 pointer-fine:focus-visible:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
                  aria-label={t("sidebar.delete", { title: titleOf(conversation) })}
                  onClick={(event) => {
                    askedFrom.current = event.currentTarget;
                    setFailed(false);
                    setPending(conversation);
                  }}
                >
                  <Trash2 aria-hidden className="size-icon" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    );

  return (
    <>
      {list}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPending(null);
          setFailed(false);
        }}
        heading={t("sidebar.deleteTitle")}
        icon={Trash2}
        description={
          pending === null
            ? ""
            : t(busy === pending.id ? "sidebar.deleteBodyAnswering" : "sidebar.deleteBody", {
                title: titleOf(pending),
              })
        }
        cancelLabel={t("sidebar.cancel")}
        confirmLabel={t("sidebar.deleteConfirm")}
        onConfirm={confirm}
        destructive
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const back = askedFrom.current?.isConnected
            ? askedFrom.current
            : focusAfterDelete.current;
          back?.focus();
        }}
      >
        {failed && (
          <p
            role="alert"
            className="rounded-control border border-warn-line bg-warn px-snug py-tight text-body text-warn-ink"
          >
            {t("sidebar.deleteFailed")}
          </p>
        )}
      </AlertDialog>
    </>
  );
}
