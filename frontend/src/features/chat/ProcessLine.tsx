/**
 * The one line above an answer that says how it was looked for (#180).
 *
 * While the search runs it counts the seconds, its words shimmering; once
 * `start` arrives it folds into "Ricerca completata · N s", which opens onto
 * the steps. One line, folded, as Perplexity's "Ricerca completata · 3s" and
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
 * The seconds once done are the server's (`StartEvent.search_ms`), stored with
 * the answer, so a conversation reopened later shows the same number; a turn
 * without them shows none. The running count is this
 * line's own, from when the turn appeared, since the server says nothing until
 * the search is over.
 *
 * A native `<details>`: the keyboard, the expanded state a screen reader
 * announces, and find-in-page opening it all come with the element.
 */

import { Check, ChevronRight, Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { Citation, RouteDecision } from "@/api/contract";
import { Chip } from "@/components/ui/chip";
import { languageList, languageName } from "@/i18n";
import { sourcesOf } from "./sourceLabel";

interface ProcessLineProps {
  /** The turn is waiting on the server, which has not said where it looked yet. */
  running: boolean;
  route: RouteDecision | null;
  searchMs: number | null;
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

/** Whole seconds since `counting` became true, from 1, ticking once a second. */
function useSeconds(counting: boolean): number {
  const [seconds, setSeconds] = useState(1);
  useEffect(() => {
    if (!counting) return;
    setSeconds(1);
    const timer = setInterval(() => setSeconds((count) => count + 1), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  return seconds;
}

/** The pill both states of the line wear. */
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
  citations,
  cited,
  locale,
}: ProcessLineProps) {
  const { t, i18n } = useTranslation();
  const seconds = useSeconds(running && route === null);

  if (route === null) {
    // Refused before `start` — a 503, a dead server — says so under the
    // answer; there was no search to report.
    if (!running) return null;
    return (
      <p className={PILL}>
        <Search aria-hidden className="size-icon shrink-0" />
        <span className="shimmer">{t("process.running", { seconds })}</span>
      </p>
    );
  }

  const sources = sourcesOf(citations);
  const citedCount = sources.filter((source) => cited?.has(source.marker)).length;
  const languages = [...new Set(sources.map((source) => source.locale))];
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
        <Step>
          <span>{t("process.read", { count: citations.length })}</span>
          {cited !== null && sources.length > 0 && (
            <span className="text-muted">· {t("process.cited", { count: citedCount })}</span>
          )}
        </Step>
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
      </ol>
    </details>
  );
}
