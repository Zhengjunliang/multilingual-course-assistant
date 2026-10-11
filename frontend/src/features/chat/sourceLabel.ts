/**
 * What a reader is shown of a source: a short name for its pill, a title for
 * its card, where it opens, and one entry per source rather than per excerpt.
 *
 * None of it is stored; it is read off the citation. A web page's short name
 * is its host without `www.`, as ChatGPT and Open WebUI write the site's name
 * in an answer (read 11 October 2026); a slide is "Slide p. N", since the
 * deck's file name in the middle of a sentence is noise. The title is the
 * first entry of `heading_path`, the document's own top heading as Docling
 * read it: the page's title on a crawled page, the deck's section on a slide.
 */

import type { TFunction } from "i18next";

import type { Citation } from "@/api/contract";
import { sourceHref } from "@/api/sources";

/** The host a reader recognises, without `www.`; the URL itself if it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function shortName(citation: Citation, t: TFunction): string {
  if (citation.kind === "web" && citation.url !== null) return hostOf(citation.url);
  return t("sources.slide", { page: citation.page });
}

export function titleOf(citation: Citation): string {
  const heading = citation.heading_path[0]?.trim();
  if (heading) return heading;
  if (citation.kind === "web" && citation.url !== null) {
    try {
      const { hostname, pathname } = new URL(citation.url);
      return `${hostname.replace(/^www\./, "")}${pathname === "/" ? "" : pathname}`;
    } catch {
      return citation.url;
    }
  }
  return citation.source_file;
}

/**
 * One citation per marker, in retrieval order. Two excerpts of one page share
 * a marker (apps/qa/contract.py), and a list of sources that named the page
 * twice would count it twice.
 */
export function sourcesOf(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.marker)) return false;
    seen.add(citation.marker);
    return true;
  });
}

/** How many words of the excerpt each end of a text fragment quotes. */
const FRAGMENT_WORDS = 4;

/** Markdown's marks in an excerpt, which the page shows as layout, not as text. */
const MARKUP = /[#*_`|>]/g;

/** A list item's bullet or number, which the page draws as a marker, not as text. */
const LIST_ITEM = /^\s*(?:[-+*]|\d+[.)])\s+/;

/** A Markdown link, of which the page shows only the text. */
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

/**
 * A table row as the chunker writes it, "Rata, Scadenza = 30 settembre": the
 * page shows cells, and no run of its text reads like that.
 */
const TABLE_ROW = / = /;

/** A term of a text fragment, with the characters its syntax reserves escaped. */
function fragmentTerm(words: readonly string[]): string {
  return encodeURIComponent(words.join(" ")).replace(/-/g, "%2D");
}

/**
 * Where a source opens.
 *
 * A slide opens at its page in the browser's PDF viewer (`sourceHref`). A web
 * page opens with a text fragment, `#:~:text=start,end` (WICG Text
 * Fragments), quoting the first and last words of the excerpt's longest line,
 * so the browser scrolls to the passage and highlights it, as Open WebUI does
 * (read 11 October 2026). One line, because a heading and the paragraph under
 * it are two blocks on the page, and a term spanning both would not be found.
 * The line is read as the page shows it: a list item without its bullet, a
 * link as its text, and a table row, which the page shows as cells, never
 * chosen. Where the page does not hold those words verbatim, or the
 * browser has no text fragments, the page opens at its top, as it did before;
 * a PDF on the web gets no fragment, since a PDF viewer reads none.
 *
 * `null` for a slide stored before its key existed, and for a web address
 * that is not an http(s) URL: there is nothing a pill may open.
 */
export function sourceLink(citation: Citation): string | null {
  if (citation.kind === "slides" || citation.url === null) {
    return citation.source_sha256 == null
      ? null
      : sourceHref(citation.source_sha256, citation.page);
  }
  let parsed: URL;
  try {
    parsed = new URL(citation.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const words = citation.text
    .split("\n")
    .filter((line) => !TABLE_ROW.test(line))
    .map((line) =>
      line
        .replace(LIST_ITEM, "")
        .replace(LINK, "$1")
        .replace(MARKUP, " ")
        .split(/\s+/)
        .filter(Boolean),
    )
    .reduce<string[]>((longest, line) => (line.length > longest.length ? line : longest), []);
  if (parsed.pathname.toLowerCase().endsWith(".pdf") || words.length === 0) return citation.url;
  const quoted =
    words.length <= 2 * FRAGMENT_WORDS
      ? fragmentTerm(words)
      : `${fragmentTerm(words.slice(0, FRAGMENT_WORDS))},${fragmentTerm(words.slice(-FRAGMENT_WORDS))}`;
  return `${citation.url}${citation.url.includes("#") ? "" : "#"}:~:text=${quoted}`;
}

/** How much of an excerpt a card or a row shows, in characters. */
const EXCERPT_CHARS = 140;

/**
 * The start of an excerpt as prose: Markdown's marks gone, whitespace
 * collapsed, cut at a word with an ellipsis once it runs past
 * `EXCERPT_CHARS`. Cut here rather than clipped by CSS: clipped lines are
 * still text, laid out under whatever follows, and axe cannot then measure
 * the excerpt's contrast (frontend/e2e/a11y.spec.ts).
 */
export function excerptOf(text: string): string {
  const prose = text.replace(MARKUP, " ").replace(/\s+/g, " ").trim();
  if (prose.length <= EXCERPT_CHARS) return prose;
  const cut = prose.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}
