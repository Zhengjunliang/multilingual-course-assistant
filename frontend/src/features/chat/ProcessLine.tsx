/**
 * The one line above an answer that says how it was looked for (#180).
 *
 * While the search runs it counts the seconds, its words shimmering; once
 * `start` arrives it folds into "Ricerca completata · N s", which opens onto
 * the steps and every source retrieved. One line, folded, as Perplexity's
 * "Ricerca completata · 3s" and Open WebUI's "Retrieved N sources" are (read
 * 11 October 2026): the reader came for the answer, and the line is there for
 * whoever wants to know how it was found.
 *
 * The seconds once done are the server's (`StartEvent.search_ms`), stored with
 * the answer, so a conversation reopened later shows the same number; an
 * answer stored before they were kept shows none. The running count is this
 * line's own, from when the turn appeared, since the server says nothing until
 * the search is over.
 *
 * A native `<details>`: the keyboard, the expanded state a screen reader
 * announces, and find-in-page opening it all come with the element.
 */

import { Check, ChevronRight, FileText, Globe, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Citation, RouteDecision } from "@/api/contract";
import { shortName, sourcesOf, titleOf } from "./sourceLabel";

interface ProcessLineProps {
  /** The turn is waiting on the server, which has not said where it looked yet. */
  running: boolean;
  route: RouteDecision | null;
  searchMs: number | null;
  citations: readonly Citation[];
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

export function ProcessLine({ running, route, searchMs, citations }: ProcessLineProps) {
  const { t } = useTranslation();
  const seconds = useSeconds(running && route === null);

  if (route === null) {
    // Refused before `start` — a 503, a dead server — says so under the
    // answer; there was no search to report.
    if (!running) return null;
    return (
      <p className="flex items-center gap-tight text-body text-muted">
        <Search aria-hidden className="size-icon shrink-0" />
        <span className="shimmer">{t("process.running", { seconds })}</span>
      </p>
    );
  }

  const sources = sourcesOf(citations);
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-tight rounded-control text-body text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <Check aria-hidden className="size-icon shrink-0" />
        <span>
          {searchMs === null
            ? t("process.doneUntimed")
            : t("process.done", { seconds: Math.max(1, Math.round(searchMs / 1000)) })}
        </span>
        <ChevronRight
          aria-hidden
          className="size-icon shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <ol className="mt-tight ml-tight flex flex-col gap-tight border-line border-l-2 pl-snug text-body text-ink">
        <li>{t("process.searchedIn", { where: t(`route.${route.target}`) })}</li>
        <li className="flex flex-col gap-tight">
          {t("process.read", { count: citations.length })}
          {sources.length > 0 && (
            <ul className="flex flex-col gap-hair">
              {sources.map((source) => (
                <li key={source.marker} className="flex min-w-0 items-center gap-tight">
                  {source.kind === "web" ? (
                    <Globe aria-hidden className="size-icon shrink-0 text-muted" />
                  ) : (
                    <FileText aria-hidden className="size-icon shrink-0 text-muted" />
                  )}
                  <span lang={source.locale} className="min-w-0 truncate">
                    {titleOf(source)}
                  </span>
                  <span className="ml-auto shrink-0 text-muted">{shortName(source, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      </ol>
    </details>
  );
}
