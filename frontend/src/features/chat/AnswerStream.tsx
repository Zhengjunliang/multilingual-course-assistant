import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import type { Badge } from "@/lib/markers";
import { withPills } from "@/lib/markers";
import { AnswerMarkdown } from "./AnswerMarkdown";

/**
 * KaTeX, fetched with the first answer that needs it.
 *
 * A chunk that fails to load falls back to the answer without typesetting: the
 * page has no error boundary, and a thrown import would take the whole chat
 * down to show one formula.
 */
const MathMarkdown = lazy(() =>
  import("./MathMarkdown").catch(() => ({ default: AnswerMarkdown })),
);

/**
 * Display math, the only kind remark-math marks here. A `$$` inside a code
 * sample matches too and costs one needless load, no more.
 */
const MATH = /\$\$[\s\S]+?\$\$/;

/**
 * What a half-written answer can make badges of: nothing. Markers are matched
 * only once the answer is complete, and sentinel characters a model wrote
 * itself are not a badge at any point.
 */
const NO_BADGES: readonly Badge[] = [];

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
 * until `end` turns the marker into a badge. Math is typeset only then too, so
 * a formula is not re-laid out on every token; until KaTeX arrives it shows as
 * its LaTeX source.
 */
export function AnswerStream({ text, badges, complete, live, onBadgeClick }: AnswerStreamProps) {
  const { t } = useTranslation();

  if (!complete) {
    return (
      <div className="flex min-w-0 flex-col">
        <AnswerMarkdown text={text} badges={NO_BADGES} onBadgeClick={onBadgeClick} />
        {live && (
          <span className="mt-hair inline-block h-4 w-2 animate-pulse bg-muted motion-reduce:animate-none">
            <span className="sr-only">{t("status.streaming")}</span>
          </span>
        )}
      </div>
    );
  }

  const plain = (
    <AnswerMarkdown text={withPills(text, badges)} badges={badges} onBadgeClick={onBadgeClick} />
  );
  if (!MATH.test(text)) return plain;
  return (
    <Suspense fallback={plain}>
      <MathMarkdown text={withPills(text, badges)} badges={badges} onBadgeClick={onBadgeClick} />
    </Suspense>
  );
}
