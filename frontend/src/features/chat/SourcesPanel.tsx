/**
 * An answer's sources, after the answer (#180).
 *
 * No product read on 11 October 2026 puts the sources above the answer:
 * ChatGPT, Gemini and Open WebUI open them from a button under it, Perplexity
 * keeps a column beside it. Here the button under the answer opens this panel
 * from the right, full width on a phone. The sources the answer cited come
 * first; the rest, retrieved and not used, follow under a heading of their
 * own, with no "not cited" mark, which none of those products shows either.
 *
 * Each row is a link to the source (`sourceLink`): a web page in a new tab at
 * its passage, a slide at its page. `SourceSummary` is the same source as the
 * hover card over a pill shows it (AnswerMarkdown.tsx), so the two never
 * describe one source two ways.
 */

import { FileText, Globe } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { distinctions, excerptOf, hostOf, sourceLink, sourcesOf, titleOf } from "./sourceLabel";

/** A web page's or a slide's mark, beside its name. */
export function SourceIcon({ citation, className }: { citation: Citation; className?: string }) {
  const Icon = citation.kind === "web" ? Globe : FileText;
  return <Icon aria-hidden className={cn("size-icon shrink-0", className)} />;
}

/**
 * Where a source is, its title, and the start of the excerpt. A slide also
 * names its edition, as code and year, the way Open edX course runs and UniFi's
 * Moodle titles name one; a slide stored before the year existed shows none.
 * `distinction` is what sets the source apart from another of its list that
 * reads the same (`distinctions`), after where it is.
 */
export function SourceSummary({
  citation,
  distinction,
}: {
  citation: Citation;
  distinction?: string | undefined;
}) {
  const { t } = useTranslation();
  const where =
    citation.kind === "web" && citation.url !== null
      ? hostOf(citation.url)
      : t("sources.filePage", { file: citation.source_file, page: citation.page });
  return (
    <>
      <span className="flex min-w-0 items-center gap-tight text-caption text-muted">
        <SourceIcon citation={citation} />
        <span className="truncate">{distinction ? `${where} · ${distinction}` : where}</span>
      </span>
      {citation.kind === "slides" && citation.academic_year != null && (
        <span className="font-mono text-caption text-muted">
          {citation.course} · {citation.academic_year}
        </span>
      )}
      <span lang={citation.locale} className="font-medium text-ink">
        {titleOf(citation)}
      </span>
      <span lang={citation.locale} className="text-muted">
        {excerptOf(citation.text)}
      </span>
    </>
  );
}

function Row({ citation, distinction }: { citation: Citation; distinction: string | undefined }) {
  const href = sourceLink(citation);
  const body = <SourceSummary citation={citation} distinction={distinction} />;
  const box = "flex flex-col gap-hair rounded-control p-tight text-body";
  return (
    <li>
      {href === null ? (
        <div className={box}>{body}</div>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${box} transition-colors hover:bg-mark`}
        >
          {body}
        </a>
      )}
    </li>
  );
}

interface SourcesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: readonly Citation[];
  /** The markers the finished answer used; `null` while it is unfinished, when all are listed as one. */
  cited: ReadonlySet<string> | null;
  /** The button under the answer that opens it, where focus returns on closing. */
  trigger: ReactElement;
}

export function SourcesPanel({ open, onOpenChange, citations, cited, trigger }: SourcesPanelProps) {
  const { t } = useTranslation();
  const sources = sourcesOf(citations);
  // Split only when the answer cited one of them. One that cited none — the
  // model left its markers out — would otherwise list everything under "the
  // rest", below an empty list, as if every source were secondary.
  const split = sources.some((source) => cited?.has(source.marker));
  const used = split ? sources.filter((source) => cited?.has(source.marker)) : sources;
  const others = split ? sources.filter((source) => !cited?.has(source.marker)) : [];
  const told = distinctions(sources);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      heading={t("sources.title")}
      closeLabel={t("sources.close")}
      side="right"
      trigger={trigger}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-tight">
        <ol className="flex flex-col gap-hair">
          {used.map((source) => (
            <Row key={source.marker} citation={source} distinction={told.get(source.marker)} />
          ))}
        </ol>
        {others.length > 0 && (
          <>
            <h3 className="px-tight pt-snug pb-hair text-caption text-muted">
              {t("sources.others")}
            </h3>
            <ol className="flex flex-col gap-hair">
              {others.map((source) => (
                <Row key={source.marker} citation={source} distinction={told.get(source.marker)} />
              ))}
            </ol>
          </>
        )}
      </div>
    </Sheet>
  );
}
