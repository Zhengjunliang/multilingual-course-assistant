/**
 * One exchange: the question, where it was searched, the answer, its sources.
 *
 * The same component draws a turn arriving token by token and a turn read back
 * out of the database an hour later, which is the reason `citations` and `route`
 * are columns on the message table. A second rendering path for history is a
 * second place for badges and greying to be got wrong.
 */

import { useTranslation } from "react-i18next";
import { badgesOf, citedMarkers } from "@/lib/markers";
import { AnswerStream } from "./AnswerStream";
import { CitationList } from "./CitationList";
import type { Turn } from "./useAsk";

interface TurnViewProps {
  turn: Turn;
  /** True only for a turn whose tokens are arriving right now. */
  live: boolean;
  highlighted: string | null;
  onHighlight: (marker: string) => void;
}

export function TurnView({ turn, live, highlighted, onHighlight }: TurnViewProps) {
  const { t } = useTranslation();
  const badges = badgesOf(turn.citations);
  const cited = turn.complete ? citedMarkers(turn.answer, badges) : null;

  return (
    <article className="flex flex-col gap-4">
      <p className="ml-auto max-w-prose whitespace-pre-wrap rounded-2xl rounded-br-sm bg-mark px-4 py-2 text-mark-ink">
        {turn.question}
      </p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="flex min-w-0 flex-col gap-2">
          {turn.route !== null && (
            <p className="text-muted text-xs">
              {t("route.label")}: {t(`route.${turn.route.target}`)} · {turn.route.reason}
            </p>
          )}
          <AnswerStream
            text={turn.answer}
            badges={badges}
            complete={turn.complete}
            live={live}
            onBadgeClick={onHighlight}
          />
          {turn.failure !== null && (
            <p className="rounded-md border border-warn-line bg-warn px-3 py-2 text-sm text-warn-ink">
              {turn.failure.kind === "reported" ? turn.failure.detail : t("error.incomplete")}
            </p>
          )}
        </section>

        {turn.citations.length > 0 && (
          <aside className="flex min-w-0 flex-col gap-2">
            <h2 className="font-medium text-muted text-xs uppercase tracking-wide">
              {t("citations.title")}
            </h2>
            <CitationList
              citations={turn.citations}
              badges={badges}
              cited={cited}
              highlighted={highlighted}
              onSelect={onHighlight}
            />
          </aside>
        )}
      </div>
    </article>
  );
}
