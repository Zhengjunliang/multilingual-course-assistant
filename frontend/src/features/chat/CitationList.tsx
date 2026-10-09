import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { sourceHref } from "@/api/sources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import type { Badge } from "@/lib/markers";
import { cn, scrollBehavior } from "@/lib/utils";

/**
 * How many source cards stand in the strip before the rest are folded away.
 *
 * A `both` route retrieves from two collections, so a turn can carry ten
 * excerpts; ten cards in a row is a scrollbar nobody drags to the end of. What
 * is folded is never lost — the count is on the button, and clicking a badge in
 * the answer unfolds the strip on its way to the card it points at.
 */
const VISIBLE_CITATIONS = 6;

interface CitationListProps {
  citations: readonly Citation[];
  badges: readonly Badge[];
  /**
   * Which markers the finished answer actually used, or `null` while the answer
   * is still arriving and the question cannot be answered yet.
   */
  cited: ReadonlySet<string> | null;
  highlighted: string | null;
  onSelect: (marker: string) => void;
}

function badgeNumber(badges: readonly Badge[], marker: string): number | null {
  return badges.find((badge) => badge.marker === marker)?.number ?? null;
}

export function CitationList({
  citations,
  badges,
  cited,
  highlighted,
  onSelect,
}: CitationListProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const strip = useRef<HTMLOListElement | null>(null);

  // Clicking a badge in the prose should land on the card it names, and the
  // card is usually off-screen sideways. When it is behind the fold instead,
  // unfolding re-runs this effect and the second pass does the scrolling.
  useEffect(() => {
    if (highlighted === null) return;
    const card = strip.current?.querySelector(`[data-marker="${CSS.escape(highlighted)}"]`);
    if (card == null) {
      if (!expanded) setExpanded(true);
      return;
    }
    card.scrollIntoView({ behavior: scrollBehavior(), block: "nearest", inline: "center" });
  }, [highlighted, expanded]);

  if (citations.length === 0) {
    return <p className="text-body text-muted">{t("citations.empty")}</p>;
  }

  const shown = expanded ? citations : citations.slice(0, VISIBLE_CITATIONS);
  const folded = citations.length - shown.length;

  return (
    <div className="flex flex-col gap-tight">
      <h2 className="font-medium text-caption text-muted uppercase tracking-wide">
        {t("citations.title")}
      </h2>
      <div className="flex items-stretch gap-tight">
        {/* A row rather than a column: sources belong beside each other, and
            stacked they push the next question off the bottom of the screen. */}
        <ol ref={strip} className="flex min-w-0 flex-1 gap-snug overflow-x-auto pb-tight">
          {shown.map((citation) => {
            const number = badgeNumber(badges, citation.marker);
            // Greyed out is a signal, not a style: retrieved and then not cited
            // is exactly what the error taxonomy wants to see.
            const unused = cited !== null && !cited.has(citation.marker);
            return (
              // Narrower and shorter on a phone. The strip now sits above the
              // answer, and a 288px card followed by a five-line excerpt would
              // put the first line of the answer below the fold — the reader
              // would see the sources instead of the reply, which is the
              // opposite of what moving them up was for.
              <li
                key={`${citation.marker}-${citation.text.slice(0, 24)}`}
                data-marker={citation.marker}
                className="w-56 shrink-0 lg:w-72"
              >
                <Card
                  className={cn(
                    "h-full transition-opacity",
                    unused && "opacity-50",
                    // Ring *and* fill. An ink ring alone is pure white on
                    // near-black in the dark theme — the loudest thing on the
                    // screen would be the border of a source card, louder than
                    // the answer it is meant to accompany. Moving half the
                    // signal onto the surface puts the hierarchy back.
                    highlighted === citation.marker && "bg-mark ring-2 ring-ink",
                  )}
                >
                  <CardHeader>
                    <CardTitle className="flex items-baseline gap-tight">
                      {number !== null && (
                        <button
                          type="button"
                          onClick={() => onSelect(citation.marker)}
                          className="rounded-full bg-mark px-tight font-medium text-caption text-ink transition-colors hover:bg-accent hover:text-accent-ink"
                        >
                          {number}
                        </button>
                      )}
                      {/* Whole, wrapped across lines: a marker cut short
                          would leave the rest only in a hint, which a touch
                          screen cannot open. */}
                      <span className="min-w-0 font-mono text-caption wrap-anywhere">
                        {citation.marker}
                      </span>
                    </CardTitle>
                    <p className="text-caption text-muted">
                      {citation.kind === "web" && citation.fetch_date !== null ? (
                        t("citations.fetched", { date: citation.fetch_date })
                      ) : citation.kind === "slides" && citation.source_sha256 != null ? (
                        // The page a slides excerpt came from, in the browser's
                        // own viewer. A card stored before the key existed has
                        // nothing to open and keeps the plain label. Its name
                        // starts with the words it shows and carries the file,
                        // which the hint shows to the eye.
                        <Tooltip content={citation.source_file}>
                          <a
                            href={sourceHref(citation.source_sha256, citation.page)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t("citations.openPage", {
                              page: citation.page,
                              file: citation.source_file,
                            })}
                            className="underline decoration-muted underline-offset-2 hover:text-ink hover:decoration-ink"
                          >
                            {t("citations.page", { page: citation.page })}
                          </a>
                        </Tooltip>
                      ) : (
                        t("citations.page", { page: citation.page })
                      )}
                      {unused ? ` · ${t("citations.uncited")}` : null}
                    </p>
                    {/* The edition, as code and year: the way Open edX course
                        runs and UniFi's Moodle titles name one, and identifiers
                        that need no translation. A web card has none, and a
                        card stored before the field existed shows nothing. */}
                    {citation.kind === "slides" && citation.academic_year != null && (
                      <p className="font-mono text-caption text-muted">
                        {citation.course} · {citation.academic_year}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {citation.url !== null && (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mb-hair block truncate text-caption text-muted underline"
                      >
                        {citation.url}
                      </a>
                    )}
                    <p
                      lang={citation.locale}
                      className="line-clamp-2 whitespace-pre-wrap lg:line-clamp-5"
                    >
                      {citation.text}
                    </p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>

        {folded > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 self-stretch rounded-card border border-line border-dashed px-snug text-caption text-muted hover:bg-mark hover:text-ink"
          >
            {t("citations.more", { count: folded })}
          </button>
        )}
      </div>
    </div>
  );
}
