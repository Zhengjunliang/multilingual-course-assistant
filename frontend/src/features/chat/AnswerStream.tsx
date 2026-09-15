import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Badge } from "@/lib/markers";
import { segmentAnswer } from "@/lib/markers";

/**
 * Sentence-final punctuation is not part of a URL: the model ends "…vp-200.html."
 * with a full stop, and a link that 404s because of it teaches the reader not to
 * click. The trailing cut is deliberate over-removal — a URL that really ends in
 * a comma is rarer than a sentence that ends after one.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Prose URLs made clickable. The model retypes these from the excerpts rather
 * than copying them, so a wrong one is possible — the links on the source cards
 * come from retrieval and stay the authoritative ones. Linking the prose copy
 * anyway beats making the reader retype what is on their screen.
 */
function linkified(text: string, base: number): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    const at = match.index;
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <a
        key={base + at}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="break-all underline decoration-muted underline-offset-2 hover:decoration-ink"
      >
        {url}
      </a>,
    );
    cursor = at + url.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

interface AnswerStreamProps {
  text: string;
  badges: readonly Badge[];
  /**
   * Whether the whole answer is in hand. Marker linking waits for it: a marker
   * is routinely split across two `token` events, so scanning a half-arrived
   * answer reports one missing and then wrong.
   */
  complete: boolean;
  /** True while tokens are still arriving, so the caret is shown only then. */
  live: boolean;
  onBadgeClick: (marker: string) => void;
}

export function AnswerStream({ text, badges, complete, live, onBadgeClick }: AnswerStreamProps) {
  const { t } = useTranslation();

  if (!complete) {
    return (
      <p className="whitespace-pre-wrap text-ink leading-relaxed">
        {text}
        {live && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-muted align-text-bottom motion-reduce:animate-none">
            <span className="sr-only">{t("status.streaming")}</span>
          </span>
        )}
      </p>
    );
  }

  return (
    <p className="whitespace-pre-wrap text-ink leading-relaxed">
      {segmentAnswer(text, badges).map((segment) =>
        segment.kind === "text" ? (
          <span key={segment.at}>{linkified(segment.text, segment.at)}</span>
        ) : (
          // A pill, not a block: it sits inside a sentence, so it is quiet by
          // default and only fills with the accent under the pointer. Filled
          // with the accent from the start, a dozen of them would read as a
          // rash across the prose rather than as places to look.
          //
          // The fill is what says "clickable" — not a colour and not a border.
          // On an achromatic palette a tinted word is impossible, and a hairline
          // is too weak to carry the job (check-contrast.mjs says so in its own
          // header). `--mark` against `--canvas` is a gated pair for this
          // reason, so the pill cannot quietly dissolve into the paragraph.
          <button
            key={segment.at}
            type="button"
            onClick={() => onBadgeClick(segment.badge.marker)}
            title={segment.badge.marker}
            className="mx-0.5 rounded-full bg-mark px-tight align-baseline font-medium text-caption text-ink transition-colors hover:bg-accent hover:text-accent-ink"
          >
            {segment.badge.number}
          </button>
        ),
      )}
    </p>
  );
}
