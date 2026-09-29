/**
 * Linking the prose back to the excerpts it was grounded on.
 *
 * This runs once, after `end`, and never during the stream. The reason is in
 * `apps/qa/contract.py`: a marker is routinely split across two `token` events,
 * so `marker in answer` is only meaningful on the joined answer. Highlighting
 * as tokens arrive would report a marker missing and then wrong.
 */

import type { Citation } from "@/api/contract";

/** One distinct source, and the small number shown in the prose. */
export interface Badge {
  marker: string;
  number: number;
}

/**
 * Distinct markers in retrieval order, numbered from one.
 *
 * Two chunks of the same page share a marker and are two citations; they get
 * one badge, because the reader is being pointed at one page.
 */
export function badgesOf(citations: readonly Citation[]): Badge[] {
  const seen = new Set<string>();
  const badges: Badge[] = [];
  for (const citation of citations) {
    if (seen.has(citation.marker)) continue;
    seen.add(citation.marker);
    badges.push({ marker: citation.marker, number: badges.length + 1 });
  }
  return badges;
}

/**
 * The system prompt forbids writing "Excerpt N" and the small quantized model
 * writes it anyway — bracketed, parenthesised, or bare. The reference is still
 * exact: the generation prompt numbers excerpts from one in citation order
 * (rag/answer.py `Excerpt {number} {marker}:`), so "Excerpt 3" names
 * `citations[2]`. Rewriting the reference into that citation's literal marker
 * BEFORE matching keeps every later step — segmentation, greying, badge
 * tooltips — marker-only, exactly as if the model had complied.
 *
 * A number with no citation behind it is left as prose: inventing a badge for
 * it would be the one thing worse than a grey card.
 */
export function resolveExcerptRefs(answer: string, citations: readonly Citation[]): string {
  return answer.replace(
    /\[Excerpt\s+(\d+)\]|\(Excerpt\s+(\d+)\)|\bExcerpt\s+(\d+)\b/g,
    (match, bracketed?: string, parenthesised?: string, bare?: string) => {
      const citation = citations[Number(bracketed ?? parenthesised ?? bare) - 1];
      return citation === undefined ? match : citation.marker;
    },
  );
}

/**
 * `at` is the offset the segment starts at in the answer. It is carried rather
 * than derived because it is the only stable identity a segment has: the array
 * index shifts whenever a marker is found or missed, and React would reuse the
 * wrong node.
 */
export type Segment =
  | { kind: "text"; at: number; text: string }
  | { kind: "badge"; at: number; badge: Badge };

interface Occurrence {
  at: number;
  badge: Badge;
}

/**
 * The answer, cut into prose and badges.
 *
 * Markers are matched longest-first so that one which is a prefix of another —
 * two pages of the same deck differ only by a digit — cannot shadow it, and
 * overlapping matches are dropped rather than nested.
 */
export function segmentAnswer(answer: string, badges: readonly Badge[]): Segment[] {
  const byLength = [...badges].sort((a, b) => b.marker.length - a.marker.length);

  const found: Occurrence[] = [];
  for (const badge of byLength) {
    let at = answer.indexOf(badge.marker);
    while (at !== -1) {
      found.push({ at, badge });
      at = answer.indexOf(badge.marker, at + badge.marker.length);
    }
  }
  found.sort((a, b) => a.at - b.at);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const { at, badge } of found) {
    if (at < cursor) continue; // overlaps something already taken
    if (at > cursor) segments.push({ kind: "text", at: cursor, text: answer.slice(cursor, at) });
    segments.push({ kind: "badge", at, badge });
    cursor = at + badge.marker.length;
  }
  if (cursor < answer.length) {
    segments.push({ kind: "text", at: cursor, text: answer.slice(cursor) });
  }
  return segments;
}

/**
 * Which markers actually turned up.
 *
 * The complement is the interesting half: a citation that was retrieved and
 * then not used is exactly the signal the error taxonomy wants, so the reader
 * sees it greyed out rather than not at all.
 */
export function citedMarkers(answer: string, badges: readonly Badge[]): Set<string> {
  return new Set(badges.filter((badge) => answer.includes(badge.marker)).map((b) => b.marker));
}

/*
 * Markers through Markdown.
 *
 * A marker cannot go through the Markdown parser as itself: a web marker holds
 * a URL, and GFM would autolink it and split the badge in two. So once the
 * answer is complete each marker becomes a sentinel — OPEN, the badge number,
 * CLOSE, all characters no model writes and no Markdown syntax reacts to — and
 * `remarkPills` turns the sentinels back into badges in the parsed tree.
 * LibreChat carries its citations through the parse the same way. Encoding and
 * decoding live here together because they are one format.
 *
 * BREAK is there for one parser rule. A GFM autolink runs until whitespace, and
 * a private-use character is not whitespace, so `https://x.it/a` followed by
 * OPEN would swallow the badge into the link. U+FEFF counts as whitespace to
 * micromark (it tests `/\s/`, as JavaScript does), so it ends the link.
 */
export const PILL_OPEN = String.fromCharCode(0xe000);
export const PILL_CLOSE = String.fromCharCode(0xe001);
export const PILL_BREAK = String.fromCharCode(0xfeff);

const SENTINELS = /[﻿]/g;
const PILL = /(\d+)/g;
const WHITESPACE = /\s/;

/**
 * Whether the character before a marker needs BREAK between them.
 *
 * Only when that character could continue a URL. Not at the start or after
 * whitespace, and not after an emphasis run that opens there — `**[m] text**`
 * needs the `**` to touch a non-space to open. A run that closes something,
 * `**Nota.**[m]`, gets BREAK: after punctuation, `**` closes only before
 * whitespace or punctuation, and a private-use character is neither.
 */
function needsBreak(text: string, at: number): boolean {
  let run = at;
  while (run > 0 && (text[run - 1] === "*" || text[run - 1] === "_")) run -= 1;
  const before = text[run - 1];
  return before !== undefined && !WHITESPACE.test(before);
}

/**
 * A complete answer with each marker replaced by its sentinel, ready to parse.
 *
 * Any sentinel character already in the answer goes first: the characters are
 * this format's, and a stray one would read as half a badge. What comes before
 * a marker is read off that cleaned answer, the text the parser will see.
 */
export function withPills(answer: string, badges: readonly Badge[]): string {
  const clean = answer.replace(SENTINELS, "");
  return segmentAnswer(clean, badges)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const pill = `${PILL_OPEN}${segment.badge.number}${PILL_CLOSE}`;
      return needsBreak(clean, segment.at) ? PILL_BREAK + pill : pill;
    })
    .join("");
}

/**
 * The few fields of an mdast node this touches.
 *
 * A local shape rather than `@types/mdast`: that package reaches this project
 * only through react-markdown, and importing it would lean on a dependency
 * nobody declared.
 */
export interface MdNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/** Where a sentinel is shown as the marker it stands for: text a badge cannot sit in. */
const LITERAL_VALUES = new Set(["code", "inlineCode", "math", "inlineMath", "html"]);
const LINKS = new Set(["link", "linkReference"]);
const IMAGES = new Set(["image", "imageReference"]);

/**
 * Turns the sentinels of `withPills` back into badges, as a remark plugin.
 *
 * A badge becomes a `citation-pill` element, a name no Markdown, rehype plugin
 * or KaTeX output can produce, so the component that draws it is the only one
 * that can. Where a badge cannot sit — code, math, raw HTML, a link's text (the
 * badge is a button, and a button inside a link is invalid), an image's alt —
 * the sentinel is written back as the marker's own text.
 *
 * Nothing here throws, whatever the model wrote. A number with no badge behind
 * it and a sentinel without its pair are dropped to plain text: the answer is
 * stored, and a throw would blank the conversation every time it is reopened.
 */
export function remarkPills(badges: readonly Badge[]) {
  const byNumber = new Map(badges.map((badge) => [String(badge.number), badge]));

  const literal = (value: string) =>
    value
      .replace(PILL, (_, number: string) => byNumber.get(number)?.marker ?? number)
      .replace(SENTINELS, "");

  const split = (value: string): MdNode[] => {
    const nodes: MdNode[] = [];
    let cursor = 0;
    const text = (slice: string) => {
      const cleaned = slice.replace(SENTINELS, "");
      if (cleaned !== "") nodes.push({ type: "text", value: cleaned });
    };
    for (const match of value.matchAll(PILL)) {
      const number = match[1] ?? "";
      text(value.slice(cursor, match.index));
      if (byNumber.has(number)) {
        nodes.push({
          type: "citationPill",
          children: [],
          data: { hName: "citation-pill", hProperties: { number } },
        });
      } else {
        text(number);
      }
      cursor = match.index + match[0].length;
    }
    text(value.slice(cursor));
    return nodes;
  };

  const visit = (node: MdNode, inLink: boolean) => {
    if (LITERAL_VALUES.has(node.type) && node.value !== undefined) node.value = literal(node.value);
    if (IMAGES.has(node.type) && typeof node.alt === "string") node.alt = literal(node.alt);
    if (node.children === undefined) return;
    const literalText = inLink || LINKS.has(node.type);
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || child.value === undefined) {
        visit(child, literalText);
        return [child];
      }
      if (literalText) return [{ ...child, value: literal(child.value) }];
      return split(child.value);
    });
  };

  return (tree: MdNode) => visit(tree, false);
}
