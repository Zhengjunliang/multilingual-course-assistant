/**
 * The row under a settled answer: copy it, open its sources, and how long the
 * search took (#180, #193).
 *
 * ChatGPT, Gemini, claude.ai, Perplexity and Open WebUI all put a copy button
 * under an answer, and ChatGPT, Gemini and Open WebUI the way to its sources
 * beside it (read 11 October 2026). The copy button says what it does and,
 * once done, that it did; what it copies is the answer without its markers
 * (`withoutMarkers`), which mean nothing outside this page. The sources button
 * shows the marks of up to three of the sources the answer cited, stacked, and
 * how many sources there are in all, cited or not; it opens the panel, and an
 * answer with no sources has none. The search's seconds close the row, as a
 * number only: the process line above the answer says the same in words.
 *
 * The row wraps rather than run past a phone's width.
 */

import { Check, Copy, Timer } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Button } from "@/components/ui/button";
import { Count } from "@/components/ui/count";
import { withoutMarkers } from "@/lib/markers";
import { searchSeconds } from "./ProcessLine";
import { SourceIcon } from "./SourceParts";
import { SourcesPanel } from "./SourcesPanel";
import { sourcesOf } from "./sourceLabel";
import { useCopy } from "./useCopy";

/** How many source marks the button stacks. */
const STACKED = 3;

interface AnswerActionsProps {
  /** The answer as the model wrote it, references and all. */
  answer: string;
  citations: readonly Citation[];
  /** The markers the answer used; `null` for an answer that did not finish. */
  cited: ReadonlySet<string> | null;
  /** The answer arrived whole; only then is there something to copy. */
  complete: boolean;
  searchMs: number | null;
  /** A source of the panel is under the pointer or the focus; `null` once none is. */
  onHighlight: (marker: string | null) => void;
}

export function AnswerActions({
  answer,
  citations,
  cited,
  complete,
  searchMs,
  onHighlight,
}: AnswerActionsProps) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  const [open, setOpen] = useState(false);

  const sources = sourcesOf(citations);
  const shown = sources.filter((source) => cited?.has(source.marker) ?? true);
  const stacked = (shown.length > 0 ? shown : sources).slice(0, STACKED);

  // Closing the panel unmounts the row under the pointer or the focus before
  // it can say it was left, so the highlight goes with the panel.
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) onHighlight(null);
  };

  if (!complete && sources.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-tight">
      {complete && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => copy(withoutMarkers(answer, citations))}
        >
          {copied ? (
            <Check aria-hidden className="size-icon" />
          ) : (
            <Copy aria-hidden className="size-icon" />
          )}
          {copied ? t("answer.copied") : t("answer.copy")}
        </Button>
      )}
      <span role="status" className="sr-only">
        {copied ? t("answer.copied") : ""}
      </span>
      {sources.length > 0 && (
        <SourcesPanel
          open={open}
          onOpenChange={openChange}
          citations={citations}
          cited={cited}
          onHighlight={onHighlight}
          trigger={
            <button
              type="button"
              aria-label={t("sources.open", { count: sources.length })}
              className="inline-flex h-control-sm items-center gap-tight rounded-full border border-line bg-surface pr-hair pl-hair font-semibold text-caption text-ink shadow-raised transition-colors hover:border-accent-line hover:bg-hover"
            >
              <span aria-hidden className="flex">
                {stacked.map((source) => (
                  <span
                    key={source.marker}
                    className="grid size-icon-lg place-items-center rounded-full border-2 border-surface bg-accent-soft text-accent not-first:-ml-1.5 [&>svg]:size-3"
                  >
                    <SourceIcon citation={source} />
                  </span>
                ))}
              </span>
              {t("sources.title")}
              <Count value={sources.length} />
            </button>
          }
        />
      )}
      {searchMs !== null && (
        <span className="inline-flex items-center gap-hair text-caption text-muted">
          <Timer aria-hidden className="size-icon" />
          <span className="sr-only">{t("answer.searchTime")}</span>
          {t("answer.seconds", { seconds: searchSeconds(searchMs) })}
        </span>
      )}
    </div>
  );
}
