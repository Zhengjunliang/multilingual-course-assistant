/**
 * An answer rendered as Markdown, with its citation markers as pills.
 *
 * Models answer in Markdown — lists, bold, tables, code — and the slides they
 * quote hold formulas; shown as plain text, all of it reaches the reader as
 * asterisks and pipes. `react-markdown` is what LibreChat and assistant-ui use
 * for the same job: it builds React elements from a syntax tree, so nothing a
 * model writes is ever parsed as HTML by the browser. Raw HTML in an answer
 * stays text (no `rehype-raw`).
 *
 * The rest of this file is what a model's output is not allowed to do, because
 * a model repeats whatever a retrieved page told it to:
 *
 * - only an absolute http(s) link is live (`safeUrl`); it opens in a new tab,
 *   and when its text hides where it goes, the host is shown after it;
 * - an image is shown as its alt text and never loaded — an image URL can carry
 *   anything the page it came from wanted to send somewhere;
 * - code is not highlighted: the palette spends its one hue on what a reader
 *   can do (index.css), and syntax colours would bring a dozen more into every
 *   code block.
 *
 * The components are one module-level object. Built inside the component, they
 * would be new functions on every render, React would rebuild every element
 * under them, and a pill would lose focus the moment it was clicked. What a
 * pill needs from its answer arrives through `PillContext` instead.
 */

import { ExternalLink } from "lucide-react";
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import Markdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { Citation } from "@/api/contract";
import { HoverCard } from "@/components/ui/hover-card";
import { remarkPills, withoutPills } from "@/lib/markers";
import { cn } from "@/lib/utils";
import { SourceSummary } from "./SourcesPanel";
import { shortName, sourceLink, sourcesOf } from "./sourceLabel";

/** The answer's citations, which a pill's excerpt numbers index from one. */
const PillContext = createContext<readonly Citation[]>([]);

/**
 * One pill, drawn where `remarkPills` left a `citation-pill` element: the
 * name of its first source, «+N» for the other pages of a run of them, as
 * ChatGPT and Open WebUI write a citation into an answer (read 11 October
 * 2026).
 *
 * The pill is a link to its first excerpt, and a click follows it: a web page
 * in a new tab at that excerpt's passage, a slide at its page. Resting on it
 * or focusing it opens a card listing every source of the run, each at the
 * first excerpt the run names on it and with its own link
 * (components/ui/hover-card.tsx): two excerpts of one page are two passages,
 * and the card shows the one the answer named (#182). One entry per page, not
 * per excerpt, because a run of five excerpts of two pages made a card taller
 * than the window. The fill is what says "clickable", not a colour or a
 * border: a blue word inside an answer would read as an ordinary link
 * (index.css), and `--mark` against `--canvas` is a gated pair so the pill
 * cannot dissolve into the paragraph. Under the pointer, and while its card
 * is open, it turns to ink.
 *
 * Numbers with no excerpt are drawn as the numbers: the plugin only emits
 * known ones, and this never throws on the rest either.
 */
function CitationPill({ numbers }: { numbers?: string }) {
  const { t } = useTranslation();
  const citations = useContext(PillContext);
  // One per page, in the order the run names them, each at the first excerpt
  // the run names on it: «+N», the card and the name a screen reader hears
  // count pages, as the sources panel does.
  const sources = sourcesOf(
    (numbers ?? "")
      .split(",")
      .map((number) => citations[Number(number) - 1])
      .filter((citation) => citation !== undefined),
  );
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
  const pill = <span className="whitespace-nowrap">{shown}</span>;
  const look =
    "mx-0.5 inline-flex items-center rounded-full bg-mark px-tight align-baseline font-medium text-caption text-muted no-underline transition-colors hover:bg-ink hover:text-canvas data-[state=open]:bg-ink data-[state=open]:text-canvas";

  return (
    <HoverCard
      content={sources.map((source) => {
        const to = sourceLink(source);
        return (
          <div key={source.marker} className="flex flex-col gap-hair">
            <SourceSummary citation={source} />
            {to !== null && (
              <a
                href={to}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-hair self-start text-caption text-accent underline underline-offset-2"
              >
                {source.kind === "web"
                  ? t("sources.openPage")
                  : t("sources.openSlide", { page: source.page })}
                <ExternalLink aria-hidden className="size-icon" />
              </a>
            )}
          </div>
        );
      })}
    >
      {href === null ? (
        // A slide stored before its key existed, or a source whose address is
        // not a web URL, has nowhere to go: a plain pill, which still previews
        // under the pointer; its source is in the sources panel for everyone
        // else.
        <span data-pill className={look}>
          {pill}
        </span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          data-pill
          className={look}
        >
          {pill}
        </a>
      )}
    </HoverCard>
  );
}

/**
 * The `urlTransform`: an absolute http(s) URL, or nothing.
 *
 * `undefined` rather than `""`, which react-markdown would write out as
 * `href=""` — a link to the page itself. A relative link has no base that means
 * anything to the reader, `javascript:` and the like are the attack, and a URL
 * that does not parse (`https://`) is dropped rather than allowed to throw.
 */
export function safeUrl(url: string): string | undefined {
  try {
    // The parsed form, not the text: `https:evil.example` parses to
    // https://evil.example/ here, where there is no base, and would be a path
    // of this site in the browser, which reads it against the page.
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** The hast nodes `textOf` walks: text, or an element with children. */
interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
}

function textOf(node: HastNode | undefined): string {
  if (node === undefined) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Link text and target, reduced to what a reader compares: host and path. */
function comparable(text: string): string {
  let decoded = text;
  try {
    decoded = decodeURI(text);
  } catch {
    // A malformed escape: compare the text as it is.
  }
  return decoded
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).host;
  } catch {
    return null;
  }
}

/**
 * A link that says where it goes.
 *
 * `[log in](https://evil.example)` is one line of an injected page away, and
 * the old plain-text answers always showed the whole URL. So whenever the text
 * is not the target itself, the host follows it. A bare URL or `www.` link,
 * whose text is its target, stays as it is.
 */
function Link({ href, children, node }: ComponentProps<"a"> & ExtraProps) {
  if (href === undefined) return <span>{children}</span>;
  const host = hostOf(href);
  const hidden = host !== null && comparable(textOf(node)) !== comparable(href);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all underline decoration-muted underline-offset-2 hover:decoration-ink"
    >
      {children}
      {hidden && <span className="text-muted no-underline">{` (${host})`}</span>}
    </a>
  );
}

/**
 * A list item without the blank lines of a loose list.
 *
 * The item keeps the model's single line breaks (`whitespace-pre-line`), and a
 * loose list puts a newline between its paragraphs, which would then show up as
 * an empty line. Only those go: the space between two inline elements of a
 * tight item, `**Prima rata** *30/09*`, is text.
 */
function ListItem({ children }: ComponentProps<"li">) {
  const kept = Children.toArray(children).filter(
    (child) => !(typeof child === "string" && child.trim() === "" && child.includes("\n")),
  );
  return <li className="whitespace-pre-line">{kept}</li>;
}

/**
 * A paragraph that keeps the model's single line breaks (`whitespace-pre-line`):
 * a line break is one to its reader, and plain Markdown would join the lines.
 *
 * A hard break, the two spaces the model ends a line with, reaches here as a
 * `<br>` and then a newline (remark-rehype writes both), and under
 * `whitespace-pre-line` the newline breaks the line a second time. The newline
 * after a `<br>` goes.
 */
function Paragraph({ children }: ComponentProps<"p">) {
  const parts = Children.toArray(children);
  const kept = parts.flatMap((child, at) => {
    const before = parts[at - 1];
    if (typeof child !== "string" || !isValidElement(before) || before.type !== "br") {
      return [child];
    }
    const rest = child.replace(/^\n/, "");
    return rest === "" ? [] : [rest];
  });
  return <p className="whitespace-pre-line">{kept}</p>;
}

// The class passes through: GFM labels a footnote section with a heading it
// marks `sr-only`, in English whatever the interface language.
function heading({ children, className }: { children?: ReactNode; className?: string }) {
  return <p className={cn("font-semibold text-ink text-reading", className)}>{children}</p>;
}

const COMPONENTS = {
  p: Paragraph,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-hair pl-gutter">{children}</ul>,
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-hair pl-gutter">{children}</ol>
  ),
  li: ListItem,
  // Headings in an answer are section labels, not page titles.
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  blockquote: ({ children }) => (
    <blockquote className="border-line border-l-2 pl-snug text-muted">{children}</blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn("rounded-chip bg-mark px-hair font-mono text-caption", className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-control bg-mark p-snug font-mono text-caption [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-body">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line px-tight py-hair text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line px-tight py-hair">{children}</td>,
  hr: () => <hr className="border-line" />,
  a: Link,
  img: ({ alt }) => <>{alt}</>,
  "citation-pill": CitationPill,
} as Components & { "citation-pill": typeof CitationPill } as Components;

export interface AnswerMarkdownProps {
  text: string;
  /** The answer's language: a Chinese answer sets at Chinese leading (index.css). */
  lang?: string;
  /**
   * The answer's citations, which a pill names and links to; none while the
   * answer streams, so that no sentinel a model wrote can draw a pill.
   */
  citations: readonly Citation[];
  rehypePlugins?: Options["rehypePlugins"];
  /** Tokens are still arriving: the caret follows the last word (index.css, `caret-after`). */
  streaming?: boolean;
}

export function AnswerMarkdown({
  text,
  lang,
  citations,
  rehypePlugins,
  streaming = false,
}: AnswerMarkdownProps) {
  // remark-cjk-friendly after remark-gfm, as its README asks: it lets bold
  // open and close next to the full-width punctuation of Chinese text.
  // remark-math only marks `$$…$$` as math here, so that Markdown escapes
  // leave its backslashes alone; typesetting it is MathMarkdown's job. A
  // single `$` is not math: answers quote prices.
  const remarkPlugins = useMemo<Options["remarkPlugins"]>(
    () => [
      remarkGfm,
      remarkCjkFriendly,
      [remarkMath, { singleDollarTextMath: false }],
      [remarkPills, citations],
    ],
    [citations],
  );

  // Called as a function, not rendered as an element, so that a throw lands
  // here. Parsing and tree building recurse, and an answer nested a few
  // thousand quotes deep exhausts the stack; there is no error boundary above
  // this, and the answer is stored, so a throw would blank the conversation
  // every time it is reopened. Such an answer is shown as the text it is.
  let body: ReactElement;
  try {
    body = Markdown({
      children: text,
      remarkPlugins,
      rehypePlugins,
      urlTransform: safeUrl,
      components: COMPONENTS,
    });
  } catch {
    body = <p className="whitespace-pre-wrap">{withoutPills(text, citations)}</p>;
  }

  return (
    <PillContext value={citations}>
      <div
        lang={lang}
        className={cn(
          "flex min-w-0 flex-col gap-snug text-ink text-reading",
          streaming && "caret-after",
        )}
      >
        {body}
      </div>
    </PillContext>
  );
}
