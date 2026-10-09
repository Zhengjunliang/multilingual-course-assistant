/**
 * The chat itself: thread and composer, inside the shell's frame
 * (routes/ShellLayout.tsx), which holds the sidebar and its conversations.
 *
 * The URL owns which conversation is open. `/` is a new one and `/c/:id` is a
 * stored one, which makes a thread a place — bookmarkable, shareable with
 * yourself, and reachable with the back button — rather than a state hidden
 * inside a component.
 *
 * That has one consequence worth naming: when the first question of a new
 * conversation gets its id, this navigates to `/c/<id>` while the answer is
 * still arriving. `loaded` is what stops that navigation from being read as
 * "open a different thread" and refetching over a stream in progress. The
 * reverse must not be read as a new id either: leaving `/c/7` for `/` renders
 * once with the URL at `/` and the hook still holding 7, before the reset lands.
 *
 * The page tells the frame two things: that the list of conversations
 * changed, and which conversation is being answered, whose delete the sidebar
 * warns will stop it. Unmounting clears the second, since leaving stops the
 * answer; deleting the conversation being answered stops it too, since the
 * frame then leaves it for `/` and the page resets.
 *
 * A visitor, on `/` only (auth/RequireSession.tsx), gets the same page with no
 * stored conversation behind it: the thread is the tab's, and with no sidebar
 * the way to a new one is a button at the top of the thread.
 */

import { MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { isRefusal } from "@/api/client";
import { readConversation } from "@/api/conversations";
import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { Composer } from "@/features/chat/Composer";
import { EmptyState } from "@/features/chat/EmptyState";
import { TurnView } from "@/features/chat/TurnView";
import { useAsk } from "@/features/chat/useAsk";
import { scrollBehavior } from "@/lib/utils";
import { useShell } from "./shell";

export default function ChatPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { account, forget, recheck } = useSession();
  const { refreshConversations, setBusy } = useShell();

  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  const visitor = account === null;
  const ask = useAsk(visitor);
  const { turns, waiting, submit, adopt, reset, stop } = ask;
  const loaded = useRef<string | null>(null);
  const previousId = useRef<number | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const refused = useCallback(
    (error: unknown) => {
      // A session that ended somewhere else — logged out in another tab, server
      // restarted — surfaces as a 403 on the next call. Dropping the account
      // here is what puts the login page in front of the reader.
      if (isRefusal(error)) forget();
    },
    [forget],
  );

  // Open whatever the URL names, and only when it changes to something this
  // component is not already holding.
  useEffect(() => {
    const wanted = conversationId ?? null;
    if (loaded.current === wanted) return;
    loaded.current = wanted;
    setUnreadable(false);

    if (wanted === null) {
      reset();
      return;
    }
    // A reply is used only while the URL still names it: a reader who moved on
    // before it arrived would otherwise be pulled back into the old thread.
    readConversation(Number(wanted))
      .then((conversation) => {
        if (loaded.current === wanted) adopt(conversation);
      })
      .catch((error: unknown) => {
        if (loaded.current !== wanted) return;
        refused(error);
        // Deleted, or never this reader's. What the page held before must go
        // with it, or a question asked here would land in that conversation.
        reset();
        setUnreadable(true);
      });
  }, [conversationId, adopt, reset, refused]);

  // A new conversation becomes a place as soon as it has an id. `replace` so
  // that the back button leaves the chat rather than stepping through one
  // question's worth of history. Only the step from no id to an id counts:
  // that is `start` naming a conversation it just created. An id that was
  // there before is the conversation being left, not one being made.
  useEffect(() => {
    const before = previousId.current;
    previousId.current = ask.conversationId;
    if (before !== null || ask.conversationId === null || conversationId !== undefined) return;
    loaded.current = String(ask.conversationId);
    void navigate(`/c/${ask.conversationId}`, { replace: true });
    refreshConversations();
  }, [ask.conversationId, conversationId, navigate, refreshConversations]);

  // Follow the answer as it is written, but only while it is being written.
  // `turns` is the trigger rather than an input — the effect reads nothing out
  // of it, it just needs to run again each time a token lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns is the trigger
  useEffect(() => {
    if (waiting.phase === "streaming" || waiting.phase === "queued") {
      bottom.current?.scrollIntoView({ behavior: scrollBehavior(), block: "end" });
    }
  }, [waiting.phase, turns]);

  // A visitor has no list to refresh; what can change under them is the
  // session, signed in from another tab.
  const onSubmit = (question: string) => {
    void submit(question).then(visitor ? recheck : refreshConversations);
  };

  // The conversation an answer is being written into. `retrying` counts: the
  // question is still on its way to the server.
  const busy =
    waiting.phase === "queued" || waiting.phase === "streaming" || waiting.phase === "retrying"
      ? ask.conversationId
      : null;

  useEffect(() => setBusy(busy), [busy, setBusy]);
  useEffect(() => () => setBusy(null), [setBusy]);

  // Before the first question the page is a front door: heading, suggestions
  // and the composer together in the middle of the screen. After it, the
  // composer parks at the foot and the thread owns the space. The composer is
  // the same component in both — it moves, it is not duplicated.
  const empty = turns.length === 0 && !unreadable;

  const composer = (
    <Composer
      waiting={waiting}
      onSubmit={onSubmit}
      onStop={stop}
      placement={empty ? "hero" : "foot"}
    />
  );

  return (
    <>
      {empty ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-room overflow-y-auto px-gutter py-room">
          <EmptyState onPick={onSubmit} visitor={visitor} />
          {composer}
        </main>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto px-gutter py-room">
            <div className="mx-auto flex max-w-4xl flex-col gap-room">
              {visitor && (
                <Button type="button" variant="ghost" className="self-start" onClick={reset}>
                  <MessageSquarePlus aria-hidden className="size-icon" />
                  {t("sidebar.new")}
                </Button>
              )}
              {unreadable && <p className="text-body text-muted">{t("sidebar.unreadable")}</p>}
              {turns.map((turn, position) => {
                // Only the last turn can be the one being answered; every
                // earlier one is settled, whether it settled a second ago or
                // last week.
                const current = position === turns.length - 1;
                return (
                  <TurnView
                    key={turn.key}
                    turn={turn}
                    live={current && waiting.phase === "streaming"}
                    thinking={
                      current && (waiting.phase === "queued" || waiting.phase === "retrying")
                    }
                    highlighted={highlighted}
                    onHighlight={setHighlighted}
                    visitor={visitor}
                  />
                );
              })}
              <div ref={bottom} />
            </div>
          </main>
          {/* No composer under "not available": a question here would start a
              conversation the URL does not name. The sidebar offers a new one. */}
          {!unreadable && composer}
        </>
      )}
    </>
  );
}
