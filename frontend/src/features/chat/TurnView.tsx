/**
 * One exchange: the question, where it was searched, the answer, its sources.
 *
 * The same component draws a turn arriving token by token and a turn read back
 * out of the database an hour later, which is the reason `citations` and `route`
 * are columns on the message table. A second rendering path for history is a
 * second place for badges and greying to be got wrong.
 */

import { useTranslation } from "react-i18next";

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
}

function Thinking() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-muted text-sm">
      <span aria-hidden className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
      </span>
      {t("status.thinking")}
    </p>
  );
}

export function TurnView({ turn, live, thinking, highlighted, onHighlight }: TurnViewProps) {
  const { t } = useTranslation();
  const badges = badgesOf(turn.citations);
  // Resolution waits for `complete` for the same reason marker matching does:
  // "[Excerpt 2]" is routinely split across two token events.
  const answer = turn.complete ? resolveExcerptRefs(turn.answer, turn.citations) : turn.answer;
  const cited = turn.complete ? citedMarkers(answer, badges) : null;
  const working = thinking || live;

  return (
    <article className="flex flex-col gap-4">
      <p className="ml-auto max-w-prose whitespace-pre-wrap rounded-2xl rounded-br-sm bg-mark px-4 py-2 text-mark-ink">
        {turn.question}
      </p>

      <div className="flex min-w-0 flex-col gap-3">
        {turn.route !== null && (
          <p className="text-muted text-xs">
            {t("route.label")}: {t(`route.${turn.route.target}`)} · {turn.route.reason}
          </p>
        )}

        {working && turn.answer === "" ? (
          <Thinking />
        ) : (
          <AnswerStream
            text={answer}
            badges={badges}
            complete={turn.complete}
            live={live}
            onBadgeClick={onHighlight}
          />
        )}

        {turn.failure !== null && (
          <p className="rounded-md border border-warn-line bg-warn px-3 py-2 text-sm text-warn-ink">
            {turn.failure.kind === "reported" ? turn.failure.detail : t("error.incomplete")}
          </p>
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
      </div>
    </article>
  );
}
