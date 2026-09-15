/**
 * The chat itself: sidebar, thread, composer.
 *
 * The URL owns which conversation is open. `/` is a new one and `/c/:id` is a
 * stored one, which makes a thread a place — bookmarkable, shareable with
 * yourself, and reachable with the back button — rather than a state hidden
 * inside a component.
 *
 * That has one consequence worth naming: when the first question of a new
 * conversation gets its id, this navigates to `/c/<id>` while the answer is
 * still arriving. `loaded` is what stops that navigation from being read as
 * "open a different thread" and refetching over a stream in progress.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { isRefusal } from "@/api/client";
import type { ConversationSummary } from "@/api/conversations";
import { listConversations, readConversation } from "@/api/conversations";
import { useSession } from "@/auth/useSession";
import { AccountMenu } from "@/components/AccountMenu";
import { ChatShell, type SidebarControls } from "@/features/chat/ChatShell";
import { Composer } from "@/features/chat/Composer";
import { ConversationSidebar } from "@/features/chat/ConversationSidebar";
import { EmptyState } from "@/features/chat/EmptyState";
import { TurnView } from "@/features/chat/TurnView";
import { useAsk } from "@/features/chat/useAsk";

export default function ChatPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { forget } = useSession();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  const ask = useAsk();
  const { turns, waiting, submit, adopt, reset, stop } = ask;
  const loaded = useRef<string | null>(null);
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

  const refreshSidebar = useCallback(() => {
    listConversations()
      .then(setConversations)
      .catch((error: unknown) => refused(error));
  }, [refused]);

  useEffect(refreshSidebar, [refreshSidebar]);

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
    readConversation(Number(wanted))
      .then(adopt)
      .catch((error: unknown) => {
        refused(error);
        setUnreadable(true);
      });
  }, [conversationId, adopt, reset, refused]);

  // A new conversation becomes a place as soon as it has an id. `replace` so
  // that the back button leaves the chat rather than stepping through one
  // question's worth of history.
  useEffect(() => {
    if (ask.conversationId === null || conversationId !== undefined) return;
    loaded.current = String(ask.conversationId);
    void navigate(`/c/${ask.conversationId}`, { replace: true });
    refreshSidebar();
  }, [ask.conversationId, conversationId, navigate, refreshSidebar]);

  // Follow the answer as it is written, but only while it is being written.
  // `turns` is the trigger rather than an input — the effect reads nothing out
  // of it, it just needs to run again each time a token lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns is the trigger
  useEffect(() => {
    if (waiting.phase === "streaming" || waiting.phase === "queued") {
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [waiting.phase, turns]);

  const onSubmit = (question: string) => {
    void submit(question).then(refreshSidebar);
  };

  const sidebar = ({ onNavigate, onCollapse }: SidebarControls) => (
    <ConversationSidebar
      conversations={conversations}
      onNavigate={onNavigate}
      onCollapse={onCollapse}
    />
  );

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
    <ChatShell sidebar={sidebar} controls={<AccountMenu />}>
      {empty ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-room overflow-y-auto px-gutter py-room">
          <EmptyState onPick={onSubmit} />
          {composer}
        </main>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto px-gutter py-room">
            <div className="mx-auto flex max-w-4xl flex-col gap-room">
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
                  />
                );
              })}
              <div ref={bottom} />
            </div>
          </main>
          {composer}
        </>
      )}
    </ChatShell>
  );
}
