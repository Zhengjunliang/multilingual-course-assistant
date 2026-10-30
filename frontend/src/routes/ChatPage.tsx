/**
 * The chat itself: thread and composer, inside the shell's frame
 * (routes/ShellLayout.tsx), which holds the sidebar and its conversations.
 *
 * The URL owns which conversation is open. `/` is a new one and `/chat/:id` is a
 * stored one, which makes a thread a place — bookmarkable, shareable with
 * yourself, and reachable with the back button — rather than a state hidden
 * inside a component.
 *
 * That has one consequence worth naming: when the first question of a new
 * conversation gets its id, this navigates to `/chat/<id>` while the answer is
 * still arriving. `loaded` is what stops that navigation from being read as
 * "open a different thread" and refetching over a stream in progress. The
 * reverse must not be read as a new id either: leaving `/chat/<id>` for `/`
 * renders once with the URL at `/` and the hook still holding the id, before
 * the reset lands.
 *
 * The page tells the frame two things: that the list of conversations
 * changed, and which conversation is being answered here, whose delete the
 * sidebar warns will stop it, as the server does (apps/qa/conversation_views.py).
 * Unmounting clears the second, since a page that is gone follows no answer:
 * a visitor's stops with it, and a student's goes on, on the worker, into the
 * conversation it was asked in (features/chat/useAsk.ts).
 *
 * A visitor, on `/` only (auth/RequireSession.tsx), gets the same page with no
 * stored conversation behind it: the thread lives in this page's memory, and a
 * reload is the way to a new one, as ChatGPT and Gemini have it for a reader
 * who is not signed in (features/chat/useAsk.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { readConversation } from "@/api/conversations";
import { isSessionLost } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { Composer } from "@/features/chat/Composer";
import { writeDraft } from "@/features/chat/draft";
import { spokenNotice } from "@/features/chat/notice";
import { ScopeButton } from "@/features/chat/ScopeButton";
import { useScope } from "@/features/chat/scope";
import { TurnView } from "@/features/chat/TurnView";
import { Unreadable } from "@/features/chat/Unreadable";
import { useAsk } from "@/features/chat/useAsk";
import { EntryScreen } from "@/features/entry/EntryScreen";
import { Room } from "@/features/entry/Room";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn, scrollBehavior } from "@/lib/utils";
import { leapt } from "./landing";
import { useShell } from "./shell";

export default function ChatPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const { key: visit, pathname } = useLocation();
  const navigate = useNavigate();
  const { account, forget, recheck } = useSession();
  const { refreshConversations, setBusy } = useShell();

  /** Why the conversation the URL names could not be read, if it could not. */
  const [unreadable, setUnreadable] = useState<{ error: unknown } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [hops, setHops] = useState(0);
  const [travelFrom, setTravelFrom] = useState<{ top: number } | null>(null);
  // Whether the cat has just jumped here from a sign-in form (#183). Only for
  // the entry it jumped to: the page stays mounted between `/` and a thread,
  // and an entry opened again later lands nothing.
  const [landed, setLanded] = useState(leapt);
  const reduced = useReducedMotion();

  const visitor = account === null;
  const ask = useAsk(visitor);
  const { turns, waiting, submit, adopt, reset, stop } = ask;
  const scope = useScope(visitor);
  const loaded = useRef<string | null>(null);
  // The navigation that last opened what the page holds.
  const visited = useRef(visit);
  const previousId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const refused = useCallback(
    (error: unknown) => {
      // A session that ended somewhere else — logged out in another tab, server
      // restarted — is refused on the next call. Dropping the account
      // here is what puts the login page in front of the reader.
      if (isSessionLost(error)) forget();
    },
    [forget],
  );

  // Open whatever the URL names, and only when it changes to something this
  // component is not already holding. `/` asked for again is a new
  // conversation all the same: a first question refused before `start` was
  // filed under none, so its thread stays on `/`, and «Nuova conversazione»
  // must still clear it. Every navigation has a key of its own, a repeated one
  // included, which is how it is told from a redraw.
  useEffect(() => {
    const wanted = conversationId ?? null;
    const again = wanted === null && visited.current !== visit;
    visited.current = visit;
    if (loaded.current === wanted && !again) return;
    loaded.current = wanted;
    setUnreadable(null);

    if (wanted === null) {
      reset();
      // An entry still receding from the question just dropped stands again
      // at once, rather than fading to its end and jumping back.
      setLeaving(false);
      return;
    }
    // A reply is used only while the URL still names it: a reader who moved on
    // before it arrived would otherwise be pulled back into the old thread.
    // An answer still being written is read back from its stream, and the list
    // read again once it settles, as after a question asked here: the list may
    // have been read while the question waited for a worker, with nothing of
    // it written yet.
    readConversation(wanted)
      .then((conversation) => {
        if (loaded.current !== wanted) return;
        const settled = adopt(conversation);
        if (conversation.answering !== null) void settled.then(refreshConversations);
      })
      .catch((error: unknown) => {
        if (loaded.current !== wanted) return;
        refused(error);
        // Deleted, never this reader's, or not read at all. What the page held
        // before must go with it, or a question asked here would land in that
        // conversation.
        reset();
        setUnreadable({ error });
      });
  }, [conversationId, visit, adopt, reset, refused, refreshConversations]);

  // A new conversation becomes a place as soon as it has an id. `replace` so
  // that the back button leaves the chat rather than stepping through one
  // question's worth of history. Only the step from no id to an id counts:
  // that is `start` naming a conversation it just created. An id that was
  // there before is the conversation being left, not one being made.
  useEffect(() => {
    const before = previousId.current;
    previousId.current = ask.conversationId;
    if (before !== null || ask.conversationId === null || conversationId !== undefined) return;
    loaded.current = ask.conversationId;
    void navigate(`/chat/${ask.conversationId}`, { replace: true });
    refreshConversations();
  }, [ask.conversationId, conversationId, navigate, refreshConversations]);

  // Follow the answer as it is written, but only while it is being written,
  // and bring a banner about it into view: the wait for a busy server, or the
  // failure that ended it.
  // `turns` is the trigger rather than an input — the effect reads nothing out
  // of it, it just needs to run again each time a token lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns is the trigger
  useEffect(() => {
    if (waiting.phase !== "idle") {
      bottom.current?.scrollIntoView({ behavior: scrollBehavior(), block: "end" });
    }
  }, [waiting.phase, turns]);

  // A visitor has no list to refresh; what can change under them is the
  // session, signed in from another tab.
  //
  // The first question leaves the entry (#173): it is sent at once, and the
  // entry stays a moment longer, while the cat hops and the entry recedes
  // (`recede`, index.css), before the thread takes its place and the
  // composer travels to its foot (#177). With reduced motion the thread is
  // there at once.
  //
  // A question refused because the session ended goes back into the box, as
  // kept for this address (draft.ts), before the login page takes over: it
  // brings the reader back here, to ask it again.
  const onSubmit = (question: string) => {
    if (empty && !reduced) {
      setLeaving(true);
      setHops((count) => count + 1);
    }
    void submit(question).then((refusal) => {
      if (isSessionLost(refusal)) {
        if (account !== null) writeDraft(account.id, pathname, question);
        forget();
      } else {
        void (visitor ? recheck() : refreshConversations());
      }
    });
  };

  // The conversation an answer is being written into. `retrying` counts: the
  // question is still on its way to the server.
  const busy =
    waiting.phase === "queued" || waiting.phase === "streaming" || waiting.phase === "retrying"
      ? ask.conversationId
      : null;

  useEffect(() => setBusy(busy), [busy, setBusy]);
  useEffect(() => () => setBusy(null), [setBusy]);

  // Before the first question the page is a front door: the cat, the caption
  // and the composer together in the middle of the screen. After it, the
  // composer parks at the foot and the thread owns the space.
  const empty = turns.length === 0 && unreadable === null;
  const entry = empty || leaving;

  const last = turns.at(-1);
  const said =
    last === undefined
      ? ""
      : spokenNotice(
          last,
          waiting.phase === "retrying" ? waiting : null,
          waiting.phase === "stopped",
          visitor,
          t,
        );

  useEffect(() => {
    if (!entry) setLanded(false);
  }, [entry]);

  const composer = (
    <Composer
      waiting={waiting}
      onSubmit={onSubmit}
      onStop={stop}
      conversation={ask.conversationId}
      placement={entry ? "hero" : "foot"}
      travelFrom={travelFrom}
      rise={landed}
      draftAt={pathname}
      draftBy={account?.id ?? null}
      scope={
        account !== null && (
          <ScopeButton
            courses={scope.data}
            declared={account.programme !== null}
            added={ask.added}
            onChoose={ask.choose}
          />
        )
      }
    />
  );

  // One tree for the entry and the thread, so the main landmark and the
  // composer stay the same elements across the switch, and what a reader
  // typed while the entry receded stays with the focus in the composer. On
  // the entry the wrapper is the centred column holding both; on the thread
  // it is `contents`, with no box of its own, and the two sit in the page's
  // column as siblings. Only the entry recedes: the composer stays in view,
  // and where its field stood as the entry went is where its travel to the
  // foot starts.
  return (
    <div
      className={
        entry
          ? "relative flex min-h-0 flex-1 flex-col items-center justify-center gap-room overflow-y-auto px-gutter py-room"
          : "contents"
      }
      onAnimationEnd={(event) => {
        if (event.animationName !== "recede") return;
        const field = document.getElementById("question");
        if (field !== null) setTravelFrom({ top: field.getBoundingClientRect().top });
        setLeaving(false);
      }}
    >
      {/* The room stands behind the entry, clear of the question box's width
          (Composer.tsx), and fades as the entry recedes (#183). */}
      {entry && <Room clear="calc(48rem + 2 * var(--spacing-room))" leaving={leaving} />}
      <main
        className={cn(
          entry
            ? "relative flex w-full justify-center"
            : "arrive min-h-0 flex-1 overflow-y-auto px-gutter py-room",
          leaving && "recede",
        )}
      >
        {entry ? (
          <EntryScreen visitor={visitor} hops={hops} landed={landed} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-room">
            {unreadable !== null && <Unreadable error={unreadable.error} />}
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
                  thinking={current && (waiting.phase === "queued" || waiting.phase === "retrying")}
                  retry={current && waiting.phase === "retrying" ? waiting : null}
                  visitor={visitor}
                />
              );
            })}
            <div ref={bottom} />
          </div>
        )}
      </main>
      {/* What happens to the question being answered, said once as it
          happens, from a region that is here before it does (notice.ts). */}
      <p role="status" className="sr-only">
        {said}
      </p>
      {/* No composer under a conversation that could not be read: a question
          here would start one the URL does not name. The sidebar offers a new one. */}
      {unreadable === null && composer}
    </div>
  );
}
