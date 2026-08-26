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
