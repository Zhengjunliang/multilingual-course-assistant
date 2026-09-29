import { useTranslation } from "react-i18next";

import type { Badge } from "@/lib/markers";
import { withPills } from "@/lib/markers";
import { AnswerMarkdown } from "./AnswerMarkdown";

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

/**
 * The answer, as Markdown while it arrives and with its badges once it is done.
 *
 * A half-written answer is parsed as it stands: an unclosed `**` shows its
 * asterisks until the closing pair arrives, and a web marker's URL is a link
 * until `end` turns the marker into a badge.
 */
export function AnswerStream({ text, badges, complete, live, onBadgeClick }: AnswerStreamProps) {
  const { t } = useTranslation();

  if (!complete) {
    return (
      <div className="flex min-w-0 flex-col">
        <AnswerMarkdown text={text} badges={badges} onBadgeClick={onBadgeClick} />
        {live && (
          <span className="mt-hair inline-block h-4 w-2 animate-pulse bg-muted motion-reduce:animate-none">
            <span className="sr-only">{t("status.streaming")}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <AnswerMarkdown text={withPills(text, badges)} badges={badges} onBadgeClick={onBadgeClick} />
  );
}
