/**
 * Linking the prose back to the excerpts it was grounded on.
 *
 * This runs once, after `end`, and never during the stream. The reason is in
 * `apps/qa/contract.py`: a marker is routinely split across two `token` events,
 * so `marker in answer` is only meaningful on the joined answer. Highlighting
 * as tokens arrive would report a marker missing and then wrong.
 */

import type { Citation } from "@/api/contract";

/**
 * The citation an excerpt number names, if the answer has one under it.
 *
 * Excerpts are numbered from one in citation order, as the generation prompt
 * numbers them (rag/answer.py `Excerpt {number} {marker}:`), so "Excerpt 3"
 * names `citations[2]`. Two chunks of one page share a marker and are two
 * excerpts, so the number, not the marker, says which passage was meant.
 */
function citationOf(citations: readonly Citation[], number: number | string): Citation | undefined {
  return citations[Number(number) - 1];
}

/** Two or more excerpt references in one pair of brackets (`excerptRefs`). */
const EXCERPT_LIST =
  /[[(（【]\s*Excerpt\s+\d+(?:(?:\s*[,;&、，；]\s*|\s+(?:e|ed|and|et|y|und|o|or)\s+|\s*[和与及或]\s*)(?:Excerpt\s+)?\d+)+\s*[\])）】]/gu;

/** One excerpt reference: bracketed, parenthesised, or bare. */
const EXCERPT_REF = /\[Excerpt\s+(\d+)\]|\(Excerpt\s+(\d+)\)|\bExcerpt\s+(\d+)\b/g;

/** A stretch of the answer that refers to excerpts, by their numbers. */
interface Occurrence {
  at: number;
  end: number;
  excerpts: number[];
}

/**
 * Where the answer names excerpts by number.
 *
 * The system prompt forbids writing "Excerpt N" and the small quantized model
 * writes it anyway — bracketed, parenthesised, or bare. The reference is
 * exact, more so than a marker: it names one excerpt, where a marker names
 * a page, and two excerpts of one page are two passages the reader can be
 * sent to.
 *
 * A list in one pair of brackets, "[Excerpt 3 e Excerpt 5]" or "(Excerpt 1,
 * 2)", is one reference to all its excerpts, brackets and conjunctions
 * included, which the pills then draw as one («name +1»); taken one by one,
 * the brackets and the "e" would be left standing between two pills. Between
 * two references of a list may stand a comma or a semicolon, half or full
 * width, an ampersand, a conjunction (e, and, et, y, und, o, or) or a Chinese
 * one; brackets may be full width. Nothing else: "Excerpt 2 to 5" is a range,
 * and reading it as two references would drop the three between them.
 *
 * A number with no citation behind it is left as prose: inventing a pill for
 * it would send the reader to a source the answer never drew on. A list
 * holding one is not a list, and its references that do resolve are taken
 * one by one.
 */
function excerptRefs(answer: string, citations: readonly Citation[]): Occurrence[] {
  const found: Occurrence[] = [];
  for (const match of answer.matchAll(EXCERPT_LIST)) {
    const excerpts = [...match[0].matchAll(/\d+/g)].map(([number]) => Number(number));
    if (excerpts.every((number) => citationOf(citations, number) !== undefined)) {
      found.push({ at: match.index, end: match.index + match[0].length, excerpts });
    }
  }
  for (const match of answer.matchAll(EXCERPT_REF)) {
    const number = Number(match[1] ?? match[2] ?? match[3]);
    if (citationOf(citations, number) !== undefined) {
      found.push({ at: match.index, end: match.index + match[0].length, excerpts: [number] });
    }
  }
  return found;
}

/**
 * Where the answer writes a marker, as the prompt asks it to. A marker names a
 * page, and stands for that page's first excerpt, its best-ranked.
 */
function markerRefs(answer: string, citations: readonly Citation[]): Occurrence[] {
  const first = new Map<string, number>();
  citations.forEach((citation, index) => {
    if (!first.has(citation.marker)) first.set(citation.marker, index + 1);
  });
  const found: Occurrence[] = [];
  for (const [marker, excerpt] of first) {
    let at = answer.indexOf(marker);
    while (at !== -1) {
      found.push({ at, end: at + marker.length, excerpts: [excerpt] });
      at = answer.indexOf(marker, at + marker.length);
    }
  }
  return found;
}

/**
 * `at` is the offset the segment starts at in the answer, which `withPills`
 * reads the character before a reference off.
 */
export type Segment =
  | { kind: "text"; at: number; text: string }
  | { kind: "reference"; at: number; excerpts: number[] };

/**
 * The answer, cut into prose and references to its excerpts.
 *
 * Where two references start at one offset the longer is taken, so a marker
 * that is a prefix of another — two pages of the same deck differ only by a
 * digit — cannot shadow it; overlapping references are dropped rather than
 * nested.
 */
export function segmentAnswer(answer: string, citations: readonly Citation[]): Segment[] {
  const found = [...excerptRefs(answer, citations), ...markerRefs(answer, citations)].sort(
    (a, b) => a.at - b.at || b.end - a.end,
  );

  const segments: Segment[] = [];
  let cursor = 0;
  for (const { at, end, excerpts } of found) {
    if (at < cursor) continue; // overlaps something already taken
    if (at > cursor) segments.push({ kind: "text", at: cursor, text: answer.slice(cursor, at) });
    segments.push({ kind: "reference", at, excerpts });
    cursor = end;
  }
  if (cursor < answer.length) {
    segments.push({ kind: "text", at: cursor, text: answer.slice(cursor) });
  }
  return segments;
}

/**
 * Which markers the answer actually cited, by writing them or by naming one of
 * their excerpts.
 *
 * The sources panel lists these first and the rest after them, under a
 * heading of their own, with no "not cited" mark: no product read on 11
 * October 2026 marks one, and
 * the complement — retrieved and then not used — is stored with the answer for
 * the error taxonomy, not shown as a fault.
 */
export function citedMarkers(answer: string, citations: readonly Citation[]): Set<string> {
  const cited = new Set<string>();
  for (const segment of segmentAnswer(answer, citations)) {
    if (segment.kind !== "reference") continue;
    for (const number of segment.excerpts) {
      const citation = citationOf(citations, number);
      if (citation !== undefined) cited.add(citation.marker);
    }
  }
  return cited;
}

const SPACE_BEFORE = /[ \t]+$/;
const SPACE_AFTER = /^[ \t]+/;

/**
 * The answer as a reader copies it: its references gone, markers and excerpt
 * numbers alike, with the spaces that led up to them, so
 * "il 30 settembre [m]." comes out "il 30 settembre.". A reference that
 * opened a line takes the space after it instead, so "[m] Le tasse" comes out
 * "Le tasse", and the copy ends where the text does. A reference means
 * nothing outside this page, and ChatGPT's copy leaves its citations out the
 * same way.
 */
export function withoutMarkers(answer: string, citations: readonly Citation[]): string {
  let copied = "";
  let lineOpened = false;
  for (const segment of segmentAnswer(answer, citations)) {
    if (segment.kind === "text") {
      copied += lineOpened ? segment.text.replace(SPACE_AFTER, "") : segment.text;
      lineOpened = false;
    } else {
      copied = copied.replace(SPACE_BEFORE, "");
      lineOpened = copied === "" || copied.endsWith("\n");
    }
  }
  return copied.trim();
}

/*
 * Markers through Markdown.
 *
 * A marker cannot go through the Markdown parser as itself: a web marker holds
 * a URL, and GFM would autolink it and split the pill in two. So once the
 * answer is complete each reference becomes a sentinel per excerpt it names —
 * OPEN, the excerpt's number, CLOSE, all characters no model writes and no
 * Markdown syntax reacts to — and `remarkPills` turns the sentinels into pills
 * in the parsed tree.
 * LibreChat carries its citations through the parse the same way. Encoding and
 * decoding live here together because they are one format.
 *
 * BREAK is there for one parser rule. A GFM autolink runs until whitespace, and
 * a private-use character is not whitespace, so `https://x.it/a` followed by
 * OPEN would swallow the pill into the link. U+FEFF counts as whitespace to
 * micromark (it tests `/\s/`, as JavaScript does), so it ends the link. GFM has
 * a second pass for the links micromark leaves alone — after full-width
 * punctuation, inside an open `[` — which stops only at an ASCII space; there
 * `remarkPills` cuts the link where the pill begins.
 */
export const PILL_OPEN = String.fromCharCode(0xe000);
export const PILL_CLOSE = String.fromCharCode(0xe001);
export const PILL_BREAK = String.fromCharCode(0xfeff);

const SENTINELS = new RegExp(`[${PILL_OPEN}${PILL_CLOSE}${PILL_BREAK}]`, "g");
const PILL = new RegExp(`${PILL_OPEN}([0-9]+)${PILL_CLOSE}`, "g");
const PILL_START = new RegExp(`[${PILL_BREAK}${PILL_OPEN}]`);
// The sentinels written as character references, which the parser would decode
// into sentinels after `withPills` had cleaned the answer.
const SENTINEL_REFERENCES = /&#(?:x0*(?:e000|e001|feff)|0*(?:57344|57345|65279));/gi;
const WHITESPACE = /\s/;
/** What may stand between two pills that are drawn as one: space, and BREAK. */
const GAP = new RegExp(`^[\\s${PILL_BREAK}]*$`);

/**
 * Whether the character before a reference needs BREAK between them.
 *
 * Only when that character could continue a URL. Not at the start or after
 * whitespace, and not after an emphasis run that opens there — `**[m] text**`
 * needs the `**` to touch a non-space to open. A run that closes something,
 * `**Nota.**[m]`, gets BREAK: after punctuation, `**` closes only before
 * whitespace or punctuation, and a private-use character is neither.
 *
 * A run is taken to open only at the start or after whitespace, so a rarer
 * spelling such as `(**[m] testo**)` keeps its asterisks, and `[m]_nota_` its
 * underscores: what the marker stood for between the delimiters is no longer
 * punctuation. Telling every opener from every closer would take the parser's
 * own delimiter rules.
 */
function needsBreak(text: string, at: number): boolean {
  let run = at;
  while (run > 0 && (text[run - 1] === "*" || text[run - 1] === "_")) run -= 1;
  const before = text[run - 1];
  return before !== undefined && !WHITESPACE.test(before);
}

/**
 * A complete answer with each reference replaced by the sentinels of its
 * excerpts, side by side, ready to parse.
 *
 * Any sentinel character already in the answer goes first, spelled out or as a
 * character reference: the characters are this format's, and a stray one would
 * read as half a pill, or as a pill the answer never cited. What comes before
 * a reference is read off that cleaned answer, the text the parser will see.
 */
export function withPills(answer: string, citations: readonly Citation[]): string {
  const clean = answer.replace(SENTINEL_REFERENCES, "").replace(SENTINELS, "");
  return segmentAnswer(clean, citations)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const pills = segment.excerpts.map((number) => `${PILL_OPEN}${number}${PILL_CLOSE}`);
      return (needsBreak(clean, segment.at) ? PILL_BREAK : "") + pills.join("");
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
  url?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/**
 * A `withPills` answer as plain prose again: sentinels written back as the
 * markers of their excerpts, and strays dropped. For an answer that cannot be
 * drawn as Markdown, and for text a pill cannot sit in.
 */
export function withoutPills(text: string, citations: readonly Citation[]): string {
  return text
    .replace(PILL, (_, number: string) => citationOf(citations, number)?.marker ?? number)
    .replace(SENTINELS, "");
}

/** Where a sentinel is shown as the marker it stands for: text a pill cannot sit in. */
const LITERAL_VALUES = new Set(["code", "inlineCode", "math", "inlineMath", "html"]);
const LINKS = new Set(["link", "linkReference"]);
const IMAGES = new Set(["image", "imageReference"]);

/**
 * Turns the sentinels of `withPills` back into pills, as a remark plugin.
 *
 * A pill becomes a `citation-pill` element, a name no Markdown, rehype plugin
 * or KaTeX output can produce, so the component that draws it is the only one
 * that can. Pills side by side, with nothing but space between them, become
 * one element carrying every excerpt number once (`numbers="1,3"`), drawn as
 * «name +1» when it spans two pages: ChatGPT and Open WebUI merge a run of
 * citations the same way (read 11 October 2026). Where a pill cannot sit —
 * code, math, raw HTML, a link's text (the pill is a link, and a link inside a
 * link is invalid), an image's alt — the sentinel is written back as the
 * marker's own text.
 *
 * Nothing here throws, whatever the model wrote. A number with no excerpt
 * behind it and a sentinel without its pair are dropped to plain text: the
 * answer is stored, and a throw would blank the conversation every time it is
 * reopened.
 */
export function remarkPills(citations: readonly Citation[]) {
  const known = (number: string) => citationOf(citations, number) !== undefined;

  const literal = (value: string) => withoutPills(value, citations);

  const split = (value: string): MdNode[] => {
    const nodes: MdNode[] = [];
    let cursor = 0;
    const text = (slice: string) => {
      const cleaned = slice.replace(SENTINELS, "");
      if (cleaned !== "") nodes.push({ type: "text", value: cleaned });
    };
    for (const match of value.matchAll(PILL)) {
      const number = match[1] ?? "";
      const between = value.slice(cursor, match.index);
      const last = nodes.at(-1);
      const numbers = last?.data?.hProperties?.numbers;
      if (known(number) && numbers !== undefined && GAP.test(between)) {
        // The pill before this one, with only space between: one pill.
        const listed = numbers.split(",");
        if (!listed.includes(number) && last?.data?.hProperties !== undefined) {
          last.data.hProperties.numbers = [...listed, number].join(",");
        }
      } else {
        text(between);
        if (known(number)) {
          nodes.push({
            type: "citationPill",
            children: [],
            data: { hName: "citation-pill", hProperties: { numbers: number } },
          });
        } else {
          text(number);
        }
      }
      cursor = match.index + match[0].length;
    }
    text(value.slice(cursor));
    return nodes;
  };

  /**
   * A link GFM found after parsing, run on into a pill: cut where the pill
   * begins, and the rest back to prose. Only such an autolink has a URL that
   * reaches a sentinel, and its one text child is the URL as written.
   */
  const cutLink = (link: MdNode): MdNode[] | null => {
    const [only] = link.children ?? [];
    const at = link.url?.search(PILL_START) ?? -1;
    const textAt = only?.value?.search(PILL_START) ?? -1;
    if (link.url === undefined || only?.value === undefined || at < 1 || textAt < 1) return null;
    return [
      {
        ...link,
        url: link.url.slice(0, at),
        children: [{ ...only, value: only.value.slice(0, textAt) }],
      },
      ...split(only.value.slice(textAt)),
    ];
  };

  const visit = (node: MdNode, inLink: boolean) => {
    if (LITERAL_VALUES.has(node.type) && node.value !== undefined) node.value = literal(node.value);
    if (IMAGES.has(node.type) && typeof node.alt === "string") node.alt = literal(node.alt);
    if (node.children === undefined) return;
    const literalText = inLink || LINKS.has(node.type);
    node.children = node.children.flatMap((child) => {
      const cut = child.type === "link" && child.children?.length === 1 ? cutLink(child) : null;
      if (cut !== null) return cut;
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
