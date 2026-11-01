/**
 * The one line above an answer that says how it was looked for (#180).
 *
 * While the search runs it lists the steps as they happen (`StepList`): the
 * queue, understanding the question, searching the material. Once `start`
 * arrives it folds into "Ricerca completata · N s", which opens onto what was
 * found and how long each step took. One line, folded, as Perplexity's
 * "Ricerca completata · 3s" and
 * Open WebUI's "Retrieved N sources" are (read 11 October 2026): the reader
 * came for the answer, and the line is there for whoever wants to know how it
 * was found. It is a bordered pill, raised like the buttons under the answer,
 * and its steps hang from a rule as a dotted timeline (#193): where it
 * searched, how many excerpts it read and how many sources the answer cited,
 * and the question's language beside its sources'. Each source is in the
 * sources panel, one press away, and not listed again here.
 *
 * The language is the one the answer was asked to be written in
 * (`StartEvent.locale`), which is the question's: that the answer kept to it
 * is the model's to get right, and is not claimed here.
 *
 * The seconds once done are the server's (`StartEvent.search_ms`, and each
 * step's `ms`), stored with the answer, so a conversation reopened later shows
 * the same numbers; a turn stored without them shows none.
 *
 * A native `<details>`: the keyboard, the expanded state a screen reader
 * announces, and find-in-page opening it all come with the element.
 */

import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { Citation, RouteDecision, StepEvent } from "@/api/contract";
import { Chip } from "@/components/ui/chip";
import { languageList, languageName } from "@/i18n";
import { StepList, shownSteps } from "./StepList";
import { sourcesOf } from "./sourceLabel";

interface ProcessLineProps {
  /** The turn is waiting on the server, which has not said where it looked yet. */
  running: boolean;
  route: RouteDecision | null;
  searchMs: number | null;
  /** The steps so far, as `Turn.steps` holds them. */
  steps: readonly StepEvent[];
  citations: readonly Citation[];
  /** The markers the finished answer used; `null` until it has finished. */
  cited: ReadonlySet<string> | null;
  /** The language the answer was asked for, from `start`; `null` until then. */
  locale: string | null;
}

/**
 * The server's milliseconds as the whole seconds shown: up to the next one,
 * as the count goes, so 2.1 s shows 3, as the count did from the second
 * second on, and never 0.
 */
export function searchSeconds(searchMs: number): number {
  return Math.max(1, Math.ceil(searchMs / 1000));
}

/** The pill the folded line wears. */
const PILL =
  "inline-flex w-fit items-center gap-tight rounded-full border border-line bg-surface py-hair pr-snug pl-hair text-body text-muted shadow-raised";

/** One step of the timeline, its dot on the rule. */
function Step({ children }: { children: ReactNode }) {
  return (
    <li className="relative flex flex-wrap items-center gap-tight">
      <span
        aria-hidden
        className="-left-[calc(var(--spacing-gutter)+var(--spacing-tight)/2+0.5px)] absolute top-[calc((var(--text-body--line-height)-var(--spacing-tight))/2)] size-tight rounded-full bg-accent"
      />
      {children}
    </li>
  );
}

export function ProcessLine({
  running,
  route,
  searchMs,
  steps,
  citations,
  cited,
  locale,
}: ProcessLineProps) {
  const { t, i18n } = useTranslation();

  if (route === null) {
    // Failed before `start` — a 503 from a server full of questions, an
    // `error` event from a worker that could not search — says so under the
    // answer; there was no search to report.
    if (!running) return null;
    // The question is in the queue from when it was sent until a worker
    // takes it, which is when the server says how long the wait was: the
    // stream has no event for the wait beginning.
    const queued: StepEvent = { name: "queue", ms: null };
    const live = steps.some((step) => step.name === "queue") ? steps : [queued, ...steps];
    return (
      <div className="w-fit rounded-card border border-line bg-surface px-snug py-tight text-body text-ink shadow-raised">
        <StepList steps={live} found={null} cited={null} live />
      </div>
    );
  }

  const sources = sourcesOf(citations);
  // Counted once the answer is whole, and only when there was something to cite.
  const citedCount =
    cited !== null && sources.length > 0
      ? sources.filter((source) => cited.has(source.marker)).length
      : null;
  const languages = [...new Set(sources.map((source) => source.locale))];
  // What the search read is said once: on its step, with its time, when the
  // answer was stored with its steps, and on a line of its own otherwise.
  const searched = steps.some((step) => step.name === "retrieve" && step.ms !== null);
  return (
    <details className="group">
      <summary
        className={`${PILL} cursor-pointer list-none transition-colors hover:border-accent-line focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden`}
      >
        <span className="grid size-icon-lg shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Check aria-hidden className="size-3" />
        </span>
        <span className="font-medium text-ink">
          {searchMs === null
            ? t("process.doneUntimed")
            : t("process.done", { seconds: searchSeconds(searchMs) })}
        </span>
        <ChevronRight
          aria-hidden
          className="size-icon shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <ol className="mt-snug ml-snug flex flex-col gap-snug border-line border-l pl-gutter text-body text-ink">
        <Step>
          <Trans
            i18nKey="process.searchedIn"
            values={{ where: t(`route.${route.target}`) }}
            components={{ where: <Chip tone="accent" /> }}
          />
        </Step>
        {!searched && (
          <Step>
            <span>{t("process.read", { count: citations.length })}</span>
            {citedCount !== null && (
              <span className="text-muted">· {t("process.cited", { count: citedCount })}</span>
            )}
          </Step>
        )}
        {locale !== null && (
          <Step>
            {languages.length === 0
              ? t("process.asked", { language: languageName(locale, i18n.language) })
              : t("process.languages", {
                  language: languageName(locale, i18n.language),
                  sources: languageList(languages, i18n.language),
                })}
          </Step>
        )}
        {/* How long each step took: the summary's seconds are those before
            `start`, the queue's included. No dot of its own, since each step
            has its tick. */}
        {shownSteps(steps, false).length > 0 && (
          <li>
            <StepList steps={steps} found={citations.length} cited={citedCount} live={false} />
          </li>
        )}
      </ol>
    </details>
  );
}
