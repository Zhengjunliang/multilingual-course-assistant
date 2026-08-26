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
  onBadgeClick: (marker: string) => void;
}

export function AnswerStream({ text, badges, complete, onBadgeClick }: AnswerStreamProps) {
  const { t } = useTranslation();

  if (!complete) {
    return (
      <p className="whitespace-pre-wrap text-slate-900 leading-relaxed">
        {text}
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-slate-400 align-text-bottom">
          <span className="sr-only">{t("status.streaming")}</span>
        </span>
      </p>
    );
  }

  return (
    <p className="whitespace-pre-wrap text-slate-900 leading-relaxed">
      {segmentAnswer(text, badges).map((segment) =>
        segment.kind === "text" ? (
          <span key={segment.at}>{segment.text}</span>
        ) : (
          <button
            key={segment.at}
            type="button"
            onClick={() => onBadgeClick(segment.badge.marker)}
            className="mx-0.5 rounded bg-slate-200 px-1.5 py-0.5 align-baseline font-medium text-slate-700 text-xs hover:bg-slate-300"
          >
            {segment.badge.number}
          </button>
        ),
      )}
    </p>
  );
}
