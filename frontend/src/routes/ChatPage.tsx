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
import { AppHeader } from "@/components/AppHeader";
import { Sheet } from "@/components/ui/sheet";
import { Composer } from "@/features/chat/Composer";
import { ConversationSidebar } from "@/features/chat/ConversationSidebar";
import { TurnView } from "@/features/chat/TurnView";
import { useAsk } from "@/features/chat/useAsk";

export default function ChatPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { forget } = useSession();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const sidebar = (
    <ConversationSidebar conversations={conversations} onNavigate={() => setDrawerOpen(false)} />
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-line border-r bg-surface lg:block">
        {sidebar}
      </aside>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title={t("sidebar.title")}>
        {sidebar}
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenSidebar={() => setDrawerOpen(true)} />

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-10">
            {unreadable && <p className="text-muted text-sm">{t("sidebar.unreadable")}</p>}
            {turns.length === 0 && !unreadable && (
              <p className="text-muted text-sm">{t("app.subtitle")}</p>
            )}
            {turns.map((turn, position) => (
              <TurnView
                key={turn.key}
                turn={turn}
                live={position === turns.length - 1 && waiting.phase === "streaming"}
                highlighted={highlighted}
                onHighlight={setHighlighted}
              />
            ))}
            <div ref={bottom} />
          </div>
        </main>

        <Composer waiting={waiting} onSubmit={onSubmit} onStop={stop} />
      </div>
    </div>
  );
}
