import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Badge } from "@/lib/markers";
import { cn } from "@/lib/utils";

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

  if (citations.length === 0) {
    return <p className="text-muted text-sm">{t("citations.empty")}</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {citations.map((citation) => {
        const number = badgeNumber(badges, citation.marker);
        // Greyed out is a signal, not a style: retrieved and then not cited is
        // exactly what the error taxonomy wants to see.
        const unused = cited !== null && !cited.has(citation.marker);
        return (
          <li key={`${citation.marker}-${citation.text.slice(0, 24)}`}>
            <Card
              className={cn(
                "transition-opacity",
                unused && "opacity-50",
                highlighted === citation.marker && "ring-2 ring-accent",
              )}
            >
              <CardHeader>
                <CardTitle className="flex items-baseline gap-2">
                  {number !== null && (
                    <button
                      type="button"
                      onClick={() => onSelect(citation.marker)}
                      className="rounded bg-mark px-1.5 py-0.5 text-mark-ink text-xs hover:opacity-80"
                    >
                      {number}
                    </button>
                  )}
                  <span className="break-all font-mono text-xs">{citation.marker}</span>
                </CardTitle>
                <p className="text-muted text-xs">
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
                    className="mb-1 block break-all text-muted text-xs underline"
                  >
                    {citation.url}
                  </a>
                )}
                <p lang={citation.locale} className="line-clamp-6 whitespace-pre-wrap">
                  {citation.text}
                </p>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
