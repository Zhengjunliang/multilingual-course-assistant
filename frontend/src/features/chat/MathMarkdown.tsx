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
// nothing.
const REHYPE: Options["rehypePlugins"] = [[rehypeKatex, { errorColor: "currentColor" }]];

export default function MathMarkdown(props: AnswerMarkdownProps) {
  return <AnswerMarkdown {...props} rehypePlugins={REHYPE} />;
}
