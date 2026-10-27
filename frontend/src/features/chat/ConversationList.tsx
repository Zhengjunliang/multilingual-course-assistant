/**
 * The sidebar's conversations: «Fissate» whenever something pinned is shown,
 * then «Recenti», each under a heading that counts its rows (#191, #192).
 *
 * The server sends the rows in their order, pinned ones first and each group
 * by its last message (apps/qa/conversation_views.py), so pinning moves a row
 * into its group and reorders nothing; this only splits the list where
 * `pinned` changes. A row is ConversationRow.tsx.
 *
 * Three states before the rows, and they are not one: `null` is a list still
 * on its way, three skeleton rows; an empty list is the server saying there
 * is nothing, the sleeping cat's panel with no button, since the question box
 * beside it is the way on; and a search that finds nothing says so in one
 * line. Showing the empty panel while the list loads would tell every reader
 * with conversations that they have none, for as long as the request takes.
 *
 * Pinning waits for the server and moves the row once the list it asks for
 * arrives; the focus follows the row to its new group, since the button it
 * was on is gone and a new one stands there. A row deleted in another tab
 * meanwhile leaves with that list, and the focus goes where a deletion's
 * would.
 *
 * Deleting asks first, and the dialog stays open until the server has
 * answered and cannot be dismissed meanwhile (ui/alert-dialog.tsx): closing it
 * first would say "deleted" about a conversation that may still be there.
 * Never disabled, not even while this conversation's answer is being written:
 * the confirmation says that answer stops (DESIGN.md, "Do's and Don'ts"). A
 * refusal says what failed, the deletion, and then why, in the interface's
 * words for its code (lib/errorText.ts).
 */

import { Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ConversationSummary } from "@/api/conversations";
import { Mascot } from "@/components/Mascot";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Count } from "@/components/ui/count";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { ErrorText } from "@/lib/errorText";
import { ConversationRow } from "./ConversationRow";
import { titleMatches } from "./rows";

interface ConversationListProps {
  /** `null` until the server has sent the list. */
  conversations: readonly ConversationSummary[] | null;
  /** What the search field holds; the rows are the titles that contain it. */
  query: string;
  /** The conversation being answered, whose deletion stops its answer. */
  busy: string | null;
  /**
   * Resolves to whether the server took it and the list that shows it came,
   * or would leave the row out (routes/ShellLayout.tsx); `retry` is how a
   * failure offers to try again.
   */
  onPin: (id: string, pinned: boolean, title: string, retry: () => void) => Promise<boolean>;
  /**
   * Resolves to `null` once the server has deleted it (routes/ShellLayout.tsx
   * leaves it), else to why it did not.
   */
  onDelete: (id: string) => Promise<ErrorText | null>;
  onNavigate?: () => void;
  /** Where focus goes once a deletion, here or in another tab, has taken the button it was on away. */
  focusAfterDelete: RefObject<HTMLElement | null>;
}

const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"];

const HEADING = "flex items-center gap-tight px-tight pt-hair font-semibold text-body text-ink";

export function ConversationList({
  conversations,
  query,
  busy,
  onPin,
  onDelete,
  onNavigate,
  focusAfterDelete,
}: ConversationListProps) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<ConversationSummary | null>(null);
  const [failed, setFailed] = useState<ErrorText | null>(null);
  // The row being pinned or unpinned and where it is going, until the list
  // that has moved it arrives.
  const [moving, setMoving] = useState<{ id: string; pinned: boolean } | null>(null);
  const pinButtons = useRef(new Map<string, HTMLButtonElement>());
  // The delete button the dialog was opened from. Radix returns focus only to
  // a `Trigger` of its own, which this dialog, opened from state, does not have.
  const askedFrom = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (moving === null || conversations === null) return;
    const row = conversations.find((conversation) => conversation.id === moving.id);
    if (row !== undefined && row.pinned !== moving.pinned) return;
    setMoving(null);
    // Only a focus the move took away: the reader may have gone on meanwhile.
    if (document.activeElement === null || document.activeElement === document.body) {
      (pinButtons.current.get(moving.id) ?? focusAfterDelete.current)?.focus();
    }
  }, [conversations, moving, focusAfterDelete]);

  const titleOf = (conversation: ConversationSummary) =>
    conversation.title || t("sidebar.untitled");

  const shown = (conversations ?? []).filter((conversation) =>
    titleMatches(titleOf(conversation), query, i18n.language),
  );

  const pin = async (conversation: ConversationSummary) => {
    const pinned = !conversation.pinned;
    setMoving({ id: conversation.id, pinned });
    const retry = () => void pin(conversation);
    if (!(await onPin(conversation.id, pinned, titleOf(conversation), retry))) {
      // Only this row's: another may have been pressed meanwhile.
      setMoving((current) => (current?.id === conversation.id ? null : current));
    }
  };

  const confirm = async () => {
    if (pending === null) return false;
    setFailed(null);
    const refusal = await onDelete(pending.id);
    setFailed(refusal);
    return refusal === null;
  };

  const rows = (group: readonly ConversationSummary[]) => (
    <ul className="flex flex-col gap-hair">
      {group.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          label={titleOf(conversation)}
          onNavigate={onNavigate}
          pinning={moving?.id === conversation.id}
          onPin={() => void pin(conversation)}
          onDelete={(button) => {
            askedFrom.current = button;
            setFailed(null);
            setPending(conversation);
          }}
          pinRef={(button) => {
            if (button === null) return;
            pinButtons.current.set(conversation.id, button);
            return () => {
              pinButtons.current.delete(conversation.id);
            };
          }}
        />
      ))}
    </ul>
  );

  const group = (label: string, members: readonly ConversationSummary[]) => (
    <nav key={label} aria-label={label} className="flex flex-col gap-hair">
      <h2 className={HEADING}>
        {label}
        <Count value={members.length} className="ml-auto" />
      </h2>
      {rows(members)}
    </nav>
  );

  const pinned = shown.filter((conversation) => conversation.pinned);
  const recent = shown.filter((conversation) => !conversation.pinned);

  // The dialog is outside the list, so deleting the last conversation, which
  // swaps the list for the empty panel, does not take the dialog with it
  // before it has given the focus back.
  let list: ReactNode;
  if (conversations === null) {
    list = (
      <nav aria-label={t("sidebar.recent")} className="flex flex-col gap-hair">
        <h2 className={HEADING}>{t("sidebar.recent")}</h2>
        <div role="status" aria-label={t("sidebar.loading")} className="flex flex-col gap-hair">
          {SKELETON_WIDTHS.map((width) => (
            <div key={width} className="flex min-h-control-sm items-center px-tight">
              <Skeleton className={width} />
            </div>
          ))}
        </div>
      </nav>
    );
  } else if (conversations.length === 0) {
    list = (
      <Empty
        visual={<Mascot pose="sleep" className="size-control" />}
        heading={t("sidebar.emptyTitle")}
      >
        {t("sidebar.emptyBody")}
      </Empty>
    );
  } else if (shown.length === 0) {
    list = (
      <nav aria-label={t("sidebar.recent")} className="flex flex-col gap-hair">
        <h2 className={HEADING}>
          {t("sidebar.recent")}
          <Count value={0} className="ml-auto" />
        </h2>
        <p className="px-tight py-tight text-body text-muted">{t("sidebar.noMatch")}</p>
      </nav>
    );
  } else {
    list = (
      <>
        {pinned.length > 0 && group(t("sidebar.pinned"), pinned)}
        {recent.length > 0 && group(t("sidebar.recent"), recent)}
      </>
    );
  }

  return (
    <>
      {list}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPending(null);
          setFailed(null);
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
        {failed !== null && (
          <div
            role="alert"
            className="flex flex-col rounded-control border border-warn-line bg-warn px-snug py-tight"
          >
            <p className="text-body text-warn-ink">
              {t("sidebar.deleteFailed")} {t(failed.sentence.key, failed.sentence.values)}
            </p>
            {failed.reference !== null && (
              <p className="text-caption text-muted">
                {t(failed.reference.key, failed.reference.values)}
              </p>
            )}
          </div>
        )}
      </AlertDialog>
    </>
  );
}
