/**
 * The pieces a source is drawn with, wherever it appears: its mark, its
 * language, and a button that copies it. The card over a pill
 * (CitationPill.tsx) and a row of the sources panel (SourcesPanel.tsx)
 * compose them, so the two never describe one source two ways.
 */

import { Check, Copy, FileText, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Tooltip } from "@/components/ui/tooltip";
import { languageCode, languageName } from "@/i18n";
import { cn } from "@/lib/utils";
import { citationText } from "./sourceLabel";
import { useCopy } from "./useCopy";

/** A web page's or a slide's mark, beside its name. */
export function SourceIcon({ citation, className }: { citation: Citation; className?: string }) {
  const Icon = citation.kind === "web" ? Globe : FileText;
  return <Icon aria-hidden className={cn("size-icon shrink-0", className)} />;
}

/**
 * A language as its code on a chip, "IT", the way the language menu shows one
 * (locale-switch.tsx), and its name in the interface's language for a screen
 * reader, which would spell the code out letter by letter.
 */
export function LanguageChip({ locale }: { locale: string }) {
  const { i18n } = useTranslation();
  return (
    <>
      <Chip size="sm" aria-hidden>
        {languageCode(locale)}
      </Chip>
      <span className="sr-only">{languageName(locale, i18n.language)}</span>
    </>
  );
}

/** Copies a source as one line of text (`citationText`), its title and where it is. */
export function CopyCitation({ citation }: { citation: Citation }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <>
      <Tooltip content={t("sources.copyCitation")}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("sources.copyCitation")}
          onClick={() => copy(citationText(citation, t))}
        >
          {copied ? (
            <Check aria-hidden className="size-icon" />
          ) : (
            <Copy aria-hidden className="size-icon" />
          )}
        </Button>
      </Tooltip>
      <span role="status" className="sr-only">
        {copied ? t("sources.citationCopied") : ""}
      </span>
    </>
  );
}
