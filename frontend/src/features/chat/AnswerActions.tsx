/**
 * The row under a settled answer: copy it, and open its sources (#180).
 *
 * ChatGPT, Gemini, claude.ai, Perplexity and Open WebUI all put a copy button
 * under an answer, and ChatGPT, Gemini and Open WebUI the way to its sources
 * beside it (read 11 October 2026). The copy is the answer without its markers
 * (`withoutMarkers`), which mean nothing outside this page. The sources button
 * shows the marks of up to three of the sources the answer cited, stacked, and
 * opens the panel; an answer with no sources has none.
 */

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { withoutMarkers } from "@/lib/markers";
import { SourceIcon, SourcesPanel } from "./SourcesPanel";
import { sourcesOf } from "./sourceLabel";

/** How long the copy button shows its tick: long enough to see, gone before a second copy. */
const COPIED_MS = 2000;

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
}

export function AnswerActions({ answer, citations, cited, complete }: AnswerActionsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(withoutMarkers(answer, citations));
      setCopied(true);
    } catch {
      // The browser refused the clipboard (an insecure origin, a denied
      // permission): the button stays as it was, which says it did not copy.
    }
  };

  const sources = sourcesOf(citations);
  const shown = sources.filter((source) => cited?.has(source.marker) ?? true);
  const stacked = (shown.length > 0 ? shown : sources).slice(0, STACKED);

  if (!complete && sources.length === 0) return null;

  return (
    <div className="flex items-center gap-hair">
      {complete && (
        <Tooltip content={t("answer.copy")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("answer.copy")}
            onClick={copy}
          >
            {copied ? (
              <Check aria-hidden className="size-icon" />
            ) : (
              <Copy aria-hidden className="size-icon" />
            )}
          </Button>
        </Tooltip>
      )}
      <span role="status" className="sr-only">
        {copied ? t("answer.copied") : ""}
      </span>
      {sources.length > 0 && (
        <SourcesPanel
          open={open}
          onOpenChange={setOpen}
          citations={citations}
          cited={cited}
          trigger={
            <button
              type="button"
              className="ml-hair inline-flex h-control-sm items-center gap-tight rounded-full border border-line bg-surface pr-snug pl-hair text-caption text-ink transition-colors hover:bg-mark"
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
            </button>
          }
        />
      )}
    </div>
  );
}
