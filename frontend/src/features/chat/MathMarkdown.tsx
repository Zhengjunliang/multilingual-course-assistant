/**
 * An answer with its `$$` math typeset by KaTeX — the one module that imports it.
 *
 * Only ever imported dynamically (AnswerStream.tsx), so Vite gives this file,
 * KaTeX, its stylesheet and its fonts chunks of their own. The first page load
 * does not carry them; an answer that holds math fetches them, the way Open
 * WebUI loads KaTeX on demand.
 *
 * `rehype-katex` rather than calling KaTeX directly: it turns KaTeX's HTML into
 * a syntax tree (parsed inside an inert `<template>`), so the formula reaches the
 * page as React elements and the frontend still has no `dangerouslySetInnerHTML`.
 */

import "katex/dist/katex.min.css";
import type { Options } from "react-markdown";
import rehypeKatex from "rehype-katex";

import { AnswerMarkdown, type AnswerMarkdownProps } from "./AnswerMarkdown";

// A formula KaTeX cannot parse is shown as its source in the text colour: the
// default #cc0000 would be the only colour on an achromatic page. `trust` keeps
// its default, false, so `\href` and `\includegraphics` in a model's formula do
// nothing. `maxSize` bounds a rule or a space, which KaTeX leaves unbounded.
const REHYPE: Options["rehypePlugins"] = [
  [rehypeKatex, { errorColor: "currentColor", maxSize: 10 }],
];

export default function MathMarkdown(props: AnswerMarkdownProps) {
  return (
    // Painting stays inside the answer: a negative skip such as `\\[-30em]`
    // is not bounded by `maxSize`, and would otherwise draw over the sources
    // above. A display formula wider than the column scrolls on its own
    // rather than widening the page.
    <div className="min-w-0 contain-paint [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden">
      <AnswerMarkdown {...props} rehypePlugins={REHYPE} />
    </div>
  );
}
