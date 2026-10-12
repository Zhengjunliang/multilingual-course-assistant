/**
 * An answer's sources, after the answer (#180).
 *
 * No product read on 11 October 2026 puts the sources above the answer:
 * ChatGPT, Gemini and Open WebUI open them from a button under it, Perplexity
 * keeps a column beside it. Here the button under the answer opens this panel
 * from the right, full width on a phone, with how many sources it holds in
 * its head. The sources the answer cited come first, under a heading of their
 * own; the rest, retrieved and not used, follow under theirs, with no "not
 * cited" mark, which none of those products shows either. Each heading
 * carries its count. When the answer cited none, or did not finish, every
 * source is in one list with no heading, since "cited" would then be a claim
 * about nothing.
 *
 * Where both kinds of source are in the list, a toggle narrows it to the
 * slides or to the web pages, in the browser (#193); a group it empties goes.
 *
 * A row says at a glance what the source is and in which language, so an
 * Italian question citing English slides shows it (#193): its mark, its title
 * and its language on a chip; a slide's page, file and edition, or a page's
 * site; then the start of the excerpt. Its title is the one link to the
 * source (`sourceLink`), stretched over the row, a web page in a new tab at
 * its passage, a slide at its page; beside it, a button copies the source as
 * text. The card over a pill holds nothing a row does not, since a keyboard
 * cannot reach that card (components/ui/hover-card.tsx). A row under the
 * pointer or the focus asks the answer to mark its pills (`onHighlight`).
 */

import { FileText, Globe } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { CopyCitation, LanguageChip, SourceIcon } from "./SourceParts";
import { distinctions, excerptOf, hostOf, sourceLink, sourcesOf, titleOf } from "./sourceLabel";

type Kind = "all" | Citation["kind"];

interface RowProps {
  citation: Citation;
  distinction: string | undefined;
  onHighlight: (marker: string | null) => void;
}

function Row({ citation, distinction, onHighlight }: RowProps) {
  const { t } = useTranslation();
  const href = sourceLink(citation);
  const title = titleOf(citation);
  const enter = () => onHighlight(citation.marker);
  const leave = () => onHighlight(null);
  return (
    <li
      className="relative flex gap-tight rounded-control p-tight text-body transition-colors hover:bg-hover"
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      <span className="grid size-control-xs shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
        <SourceIcon citation={citation} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-hair">
        <span className="flex min-w-0 items-center gap-tight">
          {href === null ? (
            <span lang={citation.locale} className="min-w-0 truncate font-semibold text-ink">
              {title}
            </span>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              lang={citation.locale}
              className="min-w-0 truncate rounded-chip font-semibold text-ink after:absolute after:inset-0 after:rounded-control focus-visible:outline-2 focus-visible:outline-accent"
            >
              {title}
            </a>
          )}
          <LanguageChip locale={citation.locale} />
        </span>
        <span className="flex min-w-0 items-center gap-tight text-caption text-muted">
          {citation.kind === "web" && citation.url !== null ? (
            <span className="truncate">
              {distinction ? `${hostOf(citation.url)} · ${distinction}` : hostOf(citation.url)}
            </span>
          ) : (
            <>
              <Chip size="sm">{t("sources.slide", { page: citation.page })}</Chip>
              <span className="min-w-0 truncate font-mono">{citation.source_file}</span>
              {citation.academic_year != null && (
                <span className="shrink-0 font-mono">
                  {citation.course} · {citation.academic_year}
                </span>
              )}
            </>
          )}
        </span>
        <span lang={citation.locale} className="text-caption text-muted">
          {excerptOf(citation.text)}
        </span>
      </div>
      {/* Above the stretched link, so a press copies rather than opens. */}
      <span className="relative shrink-0">
        <CopyCitation citation={citation} />
      </span>
    </li>
  );
}

/** A group's heading and its count. */
function Heading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="flex items-center gap-tight px-tight pt-snug pb-hair font-semibold text-caption text-muted">
      {label}
      <Count value={count} />
    </h3>
  );
}

interface SourcesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: readonly Citation[];
  /** The markers the finished answer used; `null` while it is unfinished, when all are listed as one. */
  cited: ReadonlySet<string> | null;
  /** A row is under the pointer or the focus, or, with `null`, none is. */
  onHighlight: (marker: string | null) => void;
  /** The button under the answer that opens it, where focus returns on closing. */
  trigger: ReactElement;
}

export function SourcesPanel({
  open,
  onOpenChange,
  citations,
  cited,
  onHighlight,
  trigger,
}: SourcesPanelProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("all");
  const sources = sourcesOf(citations);
  const told = distinctions(sources);
  const of = (wanted: Citation["kind"]) => sources.filter((source) => source.kind === wanted);
  const mixed = of("slides").length > 0 && of("web").length > 0;
  const shown = mixed && kind !== "all" ? of(kind) : sources;
  // Split only when the answer cited one of them. One that cited none — the
  // model left its markers out — would otherwise list everything under "the
  // rest", below an empty list, as if every source were secondary.
  const split = sources.some((source) => cited?.has(source.marker));
  const used = split ? shown.filter((source) => cited?.has(source.marker)) : shown;
  const others = split ? shown.filter((source) => !cited?.has(source.marker)) : [];
  const rows = (list: readonly Citation[]) => (
    <ol className="flex flex-col gap-hair">
      {list.map((source) => (
        <Row
          key={source.marker}
          citation={source}
          distinction={told.get(source.marker)}
          onHighlight={onHighlight}
        />
      ))}
    </ol>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      heading={t("sources.title")}
      count={sources.length}
      closeLabel={t("sources.close")}
      side="right"
      trigger={trigger}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-tight">
        {mixed && (
          <ToggleGroup
            label={t("sources.filter")}
            value={kind}
            onValueChange={setKind}
            className="mx-tight mb-tight self-start"
            options={[
              { value: "all", label: t("sources.filterAll"), count: sources.length },
              {
                value: "slides",
                label: t("sources.filterSlides"),
                icon: FileText,
                count: of("slides").length,
              },
              { value: "web", label: t("sources.filterWeb"), icon: Globe, count: of("web").length },
            ]}
          />
        )}
        {split && used.length > 0 && <Heading label={t("sources.cited")} count={used.length} />}
        {used.length > 0 && rows(used)}
        {others.length > 0 && (
          <>
            <Heading label={t("sources.others")} count={others.length} />
            {rows(others)}
          </>
        )}
      </div>
    </Sheet>
  );
}
