/**
 * A syllabus section's text, rendered from the Markdown it is stored in: the
 * bold of a heading line, a list, a link (docs/decisions.md,
 * 2026-09-25, *The data model is decided on paper*, point 4).
 *
 * `react-markdown`, as the answers use it (features/chat/AnswerMarkdown.tsx):
 * it builds React elements from a syntax tree, so raw HTML in a section stays
 * text and never reaches the browser as markup, and a link is live only when
 * it is an absolute http(s) URL (`safeUrl`). GitHub's extensions read a bare
 * URL as a link, and remark-cjk-friendly lets bold close against Chinese
 * punctuation, as the answers' syntax does.
 *
 * The editor writes no more than paragraphs, bold, italics, the two lists, a
 * link and a line break (SyllabusEditor.tsx); anything else the API was sent
 * reads as text of the same weight: a heading as a bold line, an image as its
 * alt text. A text nested deep enough to exhaust the parser's stack is shown
 * as the text it is.
 */

import type { ReactElement, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";

import { safeUrl } from "@/features/chat/AnswerMarkdown";

const PLUGINS = [remarkGfm, remarkCjkFriendly];

function heading({ children }: { children?: ReactNode }) {
  return <p className="font-semibold">{children}</p>;
}

const COMPONENTS: Components = {
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-hair pl-room marker:text-muted">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-hair pl-room marker:text-muted">{children}</ol>
  ),
  a: ({ href, children }) =>
    href === undefined ? (
      <span>{children}</span>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words underline decoration-muted underline-offset-2 hover:decoration-ink"
      >
        {children}
      </a>
    ),
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  img: ({ alt }) => <>{alt}</>,
};

interface SyllabusMarkdownProps {
  text: string;
  /** The language the syllabus is written in. */
  lang: string;
}

export function SyllabusMarkdown({ text, lang }: SyllabusMarkdownProps) {
  let body: ReactElement;
  try {
    body = Markdown({
      children: text,
      remarkPlugins: PLUGINS,
      urlTransform: safeUrl,
      components: COMPONENTS,
    });
  } catch {
    body = <p className="whitespace-pre-wrap">{text}</p>;
  }
  return (
    <div lang={lang} className="flex max-w-reading flex-col gap-snug text-ink text-reading">
      {body}
    </div>
  );
}
