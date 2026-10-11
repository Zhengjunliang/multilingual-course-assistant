/**
 * What a reader is shown of a source: a short name for its pill, a title for
 * its card, and one entry per source rather than per excerpt.
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
