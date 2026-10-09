/**
 * One exchange: the question, where it was searched, its sources, the answer.
 *
 * The same component draws a turn arriving token by token and a turn read back
 * out of the database an hour later, which is the reason `citations` and `route`
 * are columns on the message table. A second rendering path for history is a
 * second place for badges and greying to be got wrong.
 *
 * Sources sit *above* the answer, not below it. Both arrive in the same
 * `start` event, before the first token, so the reader can see what was found
 * while the answer is still being written — which is the whole difference
 * between waiting at a blank screen and watching work happen. Underneath the
 * answer they were a footnote to something already read.
 *
 * `memo` because a settled turn has nothing to redraw while another one
 * streams, and parsing its Markdown on every token would be most of the work on
 * screen. Shallow comparison is enough: `useAsk` replaces only the turn being
 * answered and keeps every other turn object as it was.
 */

import { Search } from "lucide-react";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Mascot } from "@/components/Mascot";
import { badgesOf, citedMarkers, resolveExcerptRefs } from "@/lib/markers";
import { AnswerStream } from "./AnswerStream";
import { CitationList } from "./CitationList";
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
  highlighted: string | null;
  onHighlight: (marker: string) => void;
  /**
   * Nobody is signed in. A question routed to the slides then finds nothing,
   * because the slides are for an account, and the answer says only that no
   * course material was found; the line under it says why.
   */
  visitor: boolean;
}

function Thinking() {
  const { t } = useTranslation();
  // The cat beside it is what moves: its thinking pose, whose rising dots
  // pulse. The words stay muted, the quietest voice for the one moment there
  // is nothing yet to read.
  return <p className="text-body text-muted">{t("status.thinking")}</p>;
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
  highlighted,
  onHighlight,
  visitor,
}: TurnViewProps) {
  const { t } = useTranslation();
  // Kept by identity: the answer's badges hang off this array, and a new one on
  // every render would redraw them.
  const badges = useMemo(() => badgesOf(turn.citations), [turn.citations]);
  // Resolution waits for `complete` for the same reason marker matching does:
  // "[Excerpt 2]" is routinely split across two token events.
  const answer = turn.complete ? resolveExcerptRefs(turn.answer, turn.citations) : turn.answer;
  const cited = turn.complete ? citedMarkers(answer, badges) : null;
  const working = thinking || live;
  const waiting = working && turn.answer === "";

  return (
    <article className="flex flex-col gap-gutter">
      {/* In the language it was asked in, the one the answer is written in:
          the font follows `lang` (index.css), so an Italian question keeps
          its narrow quotes in the Chinese interface and a Chinese one gets
          full-width ones in any other, and a screen reader its voice. */}
      <p
        lang={turn.locale ?? undefined}
        className="ml-auto max-w-prose whitespace-pre-wrap rounded-bubble rounded-br-chip bg-mark px-gutter py-tight text-ink"
      >
        {turn.question}
      </p>

      <div className="flex min-w-0 gap-snug">
        <Mascot pose={poseOf(turn, waiting)} className="size-avatar" />
        <div className="flex min-w-0 flex-1 flex-col gap-snug">
          {turn.route !== null && (
            <div className="flex min-w-0 flex-col gap-hair">
              {/* Body size, not the smallest type on the page. This line is the
                only place a reader is told where the answer came from, and it
                used to say so in the quietest voice available. */}
              <p className="flex flex-wrap items-center gap-tight text-body">
                <Search aria-hidden className="size-icon shrink-0 text-ink" />
                <span className="font-medium text-ink">{t(`route.${turn.route.target}`)}</span>
                <span aria-hidden className="text-line">
                  •
                </span>
                <span className="text-muted">
                  {t("route.sources", { count: turn.citations.length })}
                </span>
              </p>
              <p className="text-caption text-muted">{turn.route.reason}</p>
            </div>
          )}

          {turn.citations.length > 0 && (
            <CitationList
              citations={turn.citations}
              badges={badges}
              cited={cited}
              highlighted={highlighted}
              onSelect={onHighlight}
            />
          )}

          {waiting ? (
            <Thinking />
          ) : (
            <AnswerStream
              text={answer}
              lang={turn.locale ?? undefined}
              badges={badges}
              complete={turn.complete}
              live={live}
              onBadgeClick={onHighlight}
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
