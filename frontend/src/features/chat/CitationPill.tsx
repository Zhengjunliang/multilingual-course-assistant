import { ExternalLink } from "lucide-react";
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";

import type { Citation } from "@/api/contract";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { HoverCard } from "@/components/ui/hover-card";
import { pillSources } from "@/lib/markers";
import { CopyCitation, LanguageChip, SourceIcon } from "./SourceParts";
import { distinctions, excerptAround, hostOf, shortName, sourceLink, titleOf } from "./sourceLabel";

/** The answer's citations, which a pill's excerpt numbers index from one. */
export const PillContext = createContext<readonly Citation[]>([]);

/**
 * The marker of the source under the pointer or the focus in the sources
 * panel, whose pills take their hover look until it is left (TurnView.tsx);
 * `null` when none is. A context of its own, so a change redraws the pills
 * and not the Markdown around them.
 */
export const HighlightContext = createContext<string | null>(null);

/**
 * What a source is, on its card's tinted head: the site and what sets the page
 * apart from another of the run that reads the same, or the course's code and
 * edition, then a slide's page and the language. The course's code rather
 * than its name: a citation carries only the code, and the catalogue is the
 * server's to read.
 */
function SourceHead({
  citation,
  distinction,
}: {
  citation: Citation;
  distinction?: string | undefined;
}) {
  const { t } = useTranslation();
  let where: string;
  if (citation.kind === "web" && citation.url !== null) {
    where = distinction ? `${hostOf(citation.url)} · ${distinction}` : hostOf(citation.url);
  } else {
    where =
      [citation.course, citation.academic_year].filter(Boolean).join(" · ") || citation.source_file;
  }
  return (
    <>
      <SourceIcon citation={citation} className="text-accent" />
      <span className="min-w-0 flex-1 truncate">{where}</span>
      {citation.kind === "slides" && (
        <Chip size="sm">{t("sources.slide", { page: citation.page })}</Chip>
      )}
      <LanguageChip locale={citation.locale} />
    </>
  );
}

/**
 * The title and the excerpt around its passage, the passage on the accent's
 * tint: the line a link to the source quotes, which the browser highlights
 * when it opens a web page there (`passageOf`).
 */
function SourceBody({ citation }: { citation: Citation }) {
  const { before, passage, after } = excerptAround(citation.text);
  return (
    <>
      <span lang={citation.locale} className="font-medium text-ink">
        {titleOf(citation)}
      </span>
      <p lang={citation.locale} className="text-muted">
        {before}
        {passage !== "" && (
          <mark className="box-decoration-clone rounded-chip bg-accent-soft px-hair text-ink">
            {passage}
          </mark>
        )}
        {after}
      </p>
    </>
  );
}

/** Opening the source, as a soft button, and copying it. */
function SourceActions({ citation }: { citation: Citation }) {
  const { t } = useTranslation();
  const to = sourceLink(citation);
  return (
    <>
      {to !== null && (
        <a
          href={to}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "soft", size: "sm" })}
        >
          <ExternalLink aria-hidden className="size-icon" />
          {citation.kind === "web"
            ? t("sources.openPage")
            : t("sources.openSlide", { page: citation.page })}
        </a>
      )}
      <CopyCitation citation={citation} />
    </>
  );
}

/**
 * One pill, drawn where `remarkPills` left a `citation-pill` element: the
 * mark of its first source's kind and its name, «+N» for the other pages of a
 * run of them, as ChatGPT and Open WebUI write a citation into an answer
 * (read 11 October 2026).
 *
 * The pill is a link to its first excerpt, and a click follows it: a web page
 * in a new tab at that excerpt's passage, a slide at its page. Resting on it
 * or focusing it opens a card with a section for every source of the run,
 * each at the excerpt the answer named on it (`pillSources`, #182): what the
 * source is, the excerpt with its passage marked, and buttons to open and to
 * copy it (components/ui/hover-card.tsx). The fill is what says "clickable",
 * not a colour: a blue word inside an answer would read as an ordinary link
 * (index.css), and `--mark` against `--canvas` is a gated pair so the pill
 * cannot dissolve into the paragraph. A hairline edges it; under the pointer,
 * and while one of its sources is pointed at in the sources panel, the edge
 * turns to ink, and while its card is open the whole pill does.
 *
 * Numbers with no excerpt are drawn as the numbers: the plugin only emits
 * known ones, and this never throws on the rest either.
 */
export function CitationPill({ numbers }: { numbers?: string }) {
  const { t, i18n } = useTranslation();
  const citations = useContext(PillContext);
  const highlighted = useContext(HighlightContext);
  // One per page: «+N», the card and the name a screen reader hears count
  // pages, as the sources panel does.
  const sources = pillSources((numbers ?? "").split(",").map(Number), citations);
  const [first] = sources;
  if (first === undefined) return <>{numbers}</>;

  const href = sourceLink(first);
  const shown = `${shortName(first, t)}${sources.length > 1 ? ` +${sources.length - 1}` : ""}`;
  // The name a screen reader and voice control use starts with what the pill
  // shows (WCAG 2.5.3, label in name), then says it is a source and, for a
  // merged pill, every source its «+N» stands for. An attribute rather than
  // hidden text, which a reader's own copy and find-in-page would pick up.
  const label = t("sources.pill", {
    count: sources.length,
    shown,
    names: sources.map((source) => shortName(source, t)).join(", "),
  });
  const pill = (
    <>
      <SourceIcon citation={first} className="text-muted group-data-[state=open]:text-canvas" />
      <span className="whitespace-nowrap">{shown}</span>
    </>
  );
  const told = distinctions(sources);
  const look =
    "group mx-0.5 inline-flex items-center gap-hair rounded-full border border-line bg-mark px-tight align-baseline font-medium text-caption text-ink no-underline transition-colors hover:border-ink data-highlighted:border-ink data-[state=open]:border-ink data-[state=open]:bg-ink data-[state=open]:text-canvas";
  const pointed = sources.some((source) => source.marker === highlighted) || undefined;
  // What the pill shows and its name are the interface's words («Slide
  // p. 12», «fonte»), in its language inside an answer in another (WCAG
  // 3.1.2); a site's name reads the same in any.
  const lang = i18n.language;

  return (
    <HoverCard
      sections={sources.map((source) => ({
        key: source.marker,
        head: <SourceHead citation={source} distinction={told.get(source.marker)} />,
        body: <SourceBody citation={source} />,
        actions: <SourceActions citation={source} />,
      }))}
    >
      {href === null ? (
        // A slide stored before its key existed, or a source whose address is
        // not a web URL, has nowhere to go: a plain pill, which still previews
        // under the pointer; its source is in the sources panel for everyone
        // else.
        <span lang={lang} data-pill data-highlighted={pointed} className={look}>
          {pill}
        </span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          lang={lang}
          aria-label={label}
          data-pill
          data-highlighted={pointed}
          className={look}
        >
          {pill}
        </a>
      )}
    </HoverCard>
  );
}
