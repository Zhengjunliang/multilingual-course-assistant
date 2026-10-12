/**
 * One exchange: the question, how it was searched, the answer, its sources.
 *
 * The same component draws a turn arriving token by token and a turn read back
 * out of the database an hour later, which is the reason `citations`, `route`
 * and `search_ms` are columns on the message table. A second rendering path
 * for history is a second place for pills and sources to be got wrong.
 *
 * The answer comes first and its sources after it (#180): no product read on
 * 11 October 2026 puts them above. Above the answer is one line saying how it
 * was searched (`ProcessLine`); in it are pills naming the sources; under it,
 * once it has settled, a copy button and the button to the sources panel
 * (`AnswerActions`).
 *
 * `memo` because a settled turn has nothing to redraw while another one
 * streams, and parsing its Markdown on every token would be most of the work on
 * screen. Shallow comparison is enough: `useAsk` replaces only the turn being
 * answered and keeps every other turn object as it was.
 */

import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Mascot } from "@/components/Mascot";
import { citedMarkers } from "@/lib/markers";
import { AnswerActions } from "./AnswerActions";
import { AnswerStream } from "./AnswerStream";
import { HighlightContext } from "./CitationPill";
import { ProcessLine } from "./ProcessLine";
import { LanguageChip } from "./SourceParts";
import type { Turn } from "./useAsk";

interface TurnViewProps {
  turn: Turn;
  /** True only for a turn whose tokens are arriving right now. */
  live: boolean;
  /**
   * True while the server is working and nothing is on screen yet. That gap is
   * real work, not latency: routing asks the model where to look and retrieval
   * runs before a single event is sent (apps/qa/engine.py).
   */
  thinking: boolean;
  /**
   * The server refused the question as busy and it will be asked again. The
   * cat keeps thinking, but nothing is being searched: the process line waits,
   * and counts afresh from the next request, as the server's seconds do.
   */
  retrying: boolean;
  /**
   * Nobody is signed in. A question routed to the slides then finds nothing,
   * because the slides are for an account, and the answer says only that no
   * course material was found; the line under it says why.
   */
  visitor: boolean;
}

/**
 * The cat beside the answer says what the turn is doing: thinking until the
 * first word, apologising when it failed, and otherwise just there.
 */
function poseOf(turn: Turn, waiting: boolean) {
  if (turn.failure !== null) return "error";
  return waiting ? "thinking" : "avatar";
}

export const TurnView = memo(function TurnView({
  turn,
  live,
  thinking,
  retrying,
  visitor,
}: TurnViewProps) {
  const { t } = useTranslation();
  // References are read only once the answer is complete: a marker, or
  // "[Excerpt 2]", is routinely split across two token events.
  const cited = useMemo(
    () => (turn.complete ? citedMarkers(turn.answer, turn.citations) : null),
    [turn.complete, turn.answer, turn.citations],
  );
  // The source pointed at in the sources panel, whose pills the answer marks.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const working = thinking || live;
  const waiting = working && turn.answer === "";

  return (
    <article className="flex flex-col gap-gutter">
      {/* In the language it was asked in, the one the answer is written in:
          the font follows `lang` (index.css), so an Italian question keeps
          its narrow quotes in the Chinese interface and a Chinese one gets
          full-width ones in any other, and a screen reader its voice. That
          language is also on a chip under the bubble, per question, since a
          conversation may change language; it is known from `start` on. */}
      <div className="ml-auto flex max-w-prose flex-col items-end gap-hair">
        <p
          lang={turn.locale ?? undefined}
          className="whitespace-pre-wrap rounded-bubble rounded-br-chip border border-line bg-surface px-gutter py-tight text-ink shadow-raised"
        >
          {turn.question}
        </p>
        {turn.locale !== null && <LanguageChip locale={turn.locale} />}
      </div>

      <div className="flex min-w-0 gap-snug">
        <Mascot pose={poseOf(turn, waiting)} className="size-avatar" />
        <div className="flex min-w-0 max-w-reading flex-1 flex-col gap-snug">
          <ProcessLine
            running={working && !retrying}
            route={turn.route}
            searchMs={turn.searchMs}
            citations={turn.citations}
            cited={cited}
            locale={turn.locale}
          />

          {/* Nothing under the process line until the search is over: the
              cat's thinking pose and the line's count say the turn is
              working. Then the caret, alone until the first word. */}
          {(turn.answer !== "" || (live && turn.route !== null)) && (
            <HighlightContext value={highlighted}>
              <AnswerStream
                text={turn.answer}
                lang={turn.locale ?? undefined}
                complete={turn.complete}
                live={live}
                citations={turn.citations}
              />
            </HighlightContext>
          )}

          {!working && (
            <AnswerActions
              answer={turn.answer}
              citations={turn.citations}
              cited={cited}
              complete={turn.complete}
              searchMs={turn.searchMs}
              onHighlight={setHighlighted}
            />
          )}

          {visitor && turn.route?.target === "slides" && (
            <p className="text-body text-muted">
              {t("visitor.courseMaterial")}{" "}
              <Link to="/login" className="font-medium text-ink underline">
                {t("auth.logIn")}
              </Link>
            </p>
          )}

          {turn.failure !== null && (
            <p className="rounded-control border border-warn-line bg-warn px-snug py-tight text-body text-warn-ink">
              {turn.failure.kind === "reported" ? turn.failure.detail : t("error.incomplete")}
            </p>
          )}
        </div>
      </div>
    </article>
  );
});
