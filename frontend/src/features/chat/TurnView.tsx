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
 */

import { Search } from "lucide-react";
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
    <p className="flex items-center gap-tight text-body text-muted">
      <span aria-hidden className="flex gap-hair">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
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
    <article className="flex flex-col gap-gutter">
      <p className="ml-auto max-w-prose whitespace-pre-wrap rounded-2xl rounded-br-sm bg-mark px-gutter py-tight text-mark-ink">
        {turn.question}
      </p>

      <div className="flex min-w-0 flex-col gap-snug">
        {turn.route !== null && (
          <div className="flex min-w-0 flex-col gap-hair">
            {/* Body size, not the smallest type on the page. This line is the
                only place a reader is told where the answer came from, and it
                used to say so in the quietest voice available. */}
            <p className="flex flex-wrap items-center gap-tight text-body">
              <Search aria-hidden className="size-icon shrink-0 text-accent-text" />
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
          <p className="rounded-md border border-warn-line bg-warn px-snug py-tight text-body text-warn-ink">
            {turn.failure.kind === "reported" ? turn.failure.detail : t("error.incomplete")}
          </p>
        )}
      </div>
    </article>
  );
}
