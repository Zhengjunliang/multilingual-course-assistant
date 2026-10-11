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
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Sheet } from "@/components/ui/sheet";
import { excerptOf, hostOf, sourceLink, sourcesOf, titleOf } from "./sourceLabel";

/** A web page's or a slide's mark, beside its name. */
export function SourceIcon({ citation }: { citation: Citation }) {
  return citation.kind === "web" ? (
    <Globe aria-hidden className="size-icon shrink-0" />
  ) : (
    <FileText aria-hidden className="size-icon shrink-0" />
  );
}

/**
 * Where a source is, its title, and the start of the excerpt. A slide also
 * names its edition, as code and year, the way Open edX course runs and UniFi's
 * Moodle titles name one; a slide stored before the year existed shows none.
 */
export function SourceSummary({ citation }: { citation: Citation }) {
  const { t } = useTranslation();
  const where =
    citation.kind === "web" && citation.url !== null
      ? hostOf(citation.url)
      : t("sources.filePage", { file: citation.source_file, page: citation.page });
  return (
    <>
      <span className="flex min-w-0 items-center gap-tight text-caption text-muted">
        <SourceIcon citation={citation} />
        <span className="truncate">{where}</span>
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

function Row({ citation }: { citation: Citation }) {
  const href = sourceLink(citation);
  const body = <SourceSummary citation={citation} />;
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
  /** The markers the finished answer used; `null` while it is unfinished, when all come first. */
  cited: ReadonlySet<string> | null;
}

export function SourcesPanel({ open, onOpenChange, citations, cited }: SourcesPanelProps) {
  const { t } = useTranslation();
  const sources = sourcesOf(citations);
  const used = sources.filter((source) => cited === null || cited.has(source.marker));
  const others = sources.filter((source) => cited !== null && !cited.has(source.marker));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      heading={t("sources.title")}
      closeLabel={t("sources.close")}
      side="right"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-tight">
        <ol className="flex flex-col gap-hair">
          {used.map((source) => (
            <Row key={source.marker} citation={source} />
          ))}
        </ol>
        {others.length > 0 && (
          <>
            <h3 className="px-tight pt-snug pb-hair text-caption text-muted">
              {t("sources.others")}
            </h3>
            <ol className="flex flex-col gap-hair">
              {others.map((source) => (
                <Row key={source.marker} citation={source} />
              ))}
            </ol>
          </>
        )}
      </div>
    </Sheet>
  );
}
