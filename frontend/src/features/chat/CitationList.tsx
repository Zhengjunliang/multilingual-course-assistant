import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Badge } from "@/lib/markers";
import { cn } from "@/lib/utils";

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
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
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
                    highlighted === citation.marker && "ring-2 ring-accent",
                  )}
                >
                  <CardHeader>
                    <CardTitle className="flex items-baseline gap-tight">
                      {number !== null && (
                        <button
                          type="button"
                          onClick={() => onSelect(citation.marker)}
                          className="rounded-full border border-line px-tight font-medium text-accent-text text-caption transition-colors hover:border-accent hover:bg-accent hover:text-accent-ink"
                        >
                          {number}
                        </button>
                      )}
                      <span className="truncate font-mono text-caption" title={citation.marker}>
                        {citation.marker}
                      </span>
                    </CardTitle>
                    <p className="text-caption text-muted">
                      {citation.kind === "web" && citation.fetch_date !== null
                        ? t("citations.fetched", { date: citation.fetch_date })
                        : t("citations.page", { page: citation.page })}
                      {unused ? ` · ${t("citations.uncited")}` : null}
                    </p>
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
            className="shrink-0 self-stretch rounded-lg border border-line border-dashed px-snug text-caption text-muted hover:bg-mark hover:text-ink"
          >
            {t("citations.more", { count: folded })}
          </button>
        )}
      </div>
    </div>
  );
}
