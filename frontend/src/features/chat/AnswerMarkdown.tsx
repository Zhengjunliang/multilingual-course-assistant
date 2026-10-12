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

import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useMemo,
} from "react";
import Markdown, { type Components, type ExtraProps, type Options } from "react-markdown";

import type { Citation } from "@/api/contract";
import { ANSWER_SYNTAX, remarkPills, withoutPills } from "@/lib/markers";
import { cn } from "@/lib/utils";
import { CitationPill, PillContext } from "./CitationPill";
import { CodeBlock } from "./CodeBlock";

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
  // The bullets in muted: nothing in the reading wears the accent but a link
  // (DESIGN.md, Do's and Don'ts), and a bullet is no content of its own.
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-hair pl-gutter marker:text-muted">{children}</ul>
  ),
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
    <blockquote className="rounded-r-control border-muted border-l-2 bg-mark px-snug py-tight text-ink">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn("rounded-chip bg-mark px-hair font-mono text-caption", className)}>
      {children}
    </code>
  ),
  pre: CodeBlock,
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
  const remarkPlugins = useMemo<Options["remarkPlugins"]>(
    () => [...ANSWER_SYNTAX, [remarkPills, citations]],
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
