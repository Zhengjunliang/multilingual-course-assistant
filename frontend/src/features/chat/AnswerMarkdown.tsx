/**
 * An answer rendered as Markdown, with its citation markers as badges.
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
 * - code is not highlighted: the palette is achromatic (index.css), so syntax
 *   colours would be the only colour on the screen.
 *
 * The components are one module-level object. Built inside the component, they
 * would be new functions on every render, React would rebuild every element
 * under them, and a badge would lose focus the moment it was clicked. What a
 * badge needs from its answer arrives through `PillContext` instead.
 */

import {
  Children,
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import Markdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { type Badge, remarkPills } from "@/lib/markers";
import { cn } from "@/lib/utils";

interface Pills {
  badges: readonly Badge[];
  onBadgeClick: (marker: string) => void;
}

const PillContext = createContext<Pills | null>(null);

/**
 * One badge, drawn where `remarkPills` left a `citation-pill` element.
 *
 * A number with no badge is drawn as the number: the plugin only emits known
 * numbers, and this never throws on the rest either.
 */
function CitationPill({ number }: { number?: string }) {
  const pills = useContext(PillContext);
  const badge = pills?.badges.find((candidate) => String(candidate.number) === number);
  if (pills === null || badge === undefined) return <>{number}</>;

  return (
    // A pill, not a block: it sits inside a sentence, so it is quiet by default
    // and only fills with the accent under the pointer. Filled with the accent
    // from the start, a dozen of them would read as a rash across the prose
    // rather than as places to look.
    //
    // The fill is what says "clickable" — not a colour and not a border. On an
    // achromatic palette a tinted word is impossible, and a hairline is too weak
    // to carry the job (check-contrast.mjs says so in its own header). `--mark`
    // against `--canvas` is a gated pair for this reason, so the pill cannot
    // quietly dissolve into the paragraph.
    <button
      type="button"
      onClick={() => pills.onBadgeClick(badge.marker)}
      title={badge.marker}
      className="mx-0.5 rounded-full bg-mark px-tight align-baseline font-medium text-caption text-ink transition-colors hover:bg-accent hover:text-accent-ink"
    >
      {badge.number}
    </button>
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
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
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
      title={href}
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
 * an empty line.
 */
function ListItem({ children }: ComponentProps<"li">) {
  const kept = Children.toArray(children).filter(
    (child) => !(typeof child === "string" && child.trim() === ""),
  );
  return <li className="whitespace-pre-line">{kept}</li>;
}

function heading({ children }: { children?: ReactNode }) {
  return <p className="font-semibold text-body text-ink">{children}</p>;
}

const COMPONENTS = {
  // A model's single line break is a line break to its reader; plain Markdown
  // would join the lines.
  p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
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
    <code className={cn("rounded-sm bg-mark px-hair font-mono text-caption", className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-mark p-snug font-mono text-caption [&>code]:bg-transparent [&>code]:p-0">
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
  badges: readonly Badge[];
  onBadgeClick: (marker: string) => void;
  rehypePlugins?: Options["rehypePlugins"];
}

export function AnswerMarkdown({ text, badges, onBadgeClick, rehypePlugins }: AnswerMarkdownProps) {
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
      [remarkPills, badges],
    ],
    [badges],
  );
  const pills = useMemo(() => ({ badges, onBadgeClick }), [badges, onBadgeClick]);

  return (
    <PillContext value={pills}>
      <div className="flex min-w-0 flex-col gap-snug text-ink leading-relaxed">
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          urlTransform={safeUrl}
          components={COMPONENTS}
        >
          {text}
        </Markdown>
      </div>
    </PillContext>
  );
}
