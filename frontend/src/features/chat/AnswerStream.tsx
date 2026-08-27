import { useTranslation } from "react-i18next";

import type { Badge } from "@/lib/markers";
import { segmentAnswer } from "@/lib/markers";

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
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-muted align-text-bottom">
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
          <span key={segment.at}>{segment.text}</span>
        ) : (
          <button
            key={segment.at}
            type="button"
            onClick={() => onBadgeClick(segment.badge.marker)}
            title={segment.badge.marker}
            className="mx-0.5 rounded bg-mark px-1.5 py-0.5 align-baseline font-medium text-mark-ink text-xs hover:opacity-80"
          >
            {segment.badge.number}
          </button>
        ),
      )}
    </p>
  );
}
