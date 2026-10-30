/**
 * A page of ratings, as the superuser's page lists them (routes/FeedbackPage.tsx).
 *
 * Each row is the question, in the language it was asked in, over when it
 * was rated (DESIGN.md, rule 1), the row's one link, to the rating; the
 * thumb; the reason a rating down gave, over the start of its comment, in the
 * comment's own language; where the answer was searched; and the question's
 * language. Nothing names the student. Coming back with Back marks the row
 * the reader opened (openedRow.ts).
 */

import { ChevronRight, ThumbsDown, ThumbsUp } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { FeedbackRow } from "@/api/review";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LanguageChip } from "@/features/chat/SourceParts";

/**
 * A rating's thumb, with the words the student clicked it by (`answer.rate`).
 * Neutral either way: the warning's tone is for a failure of the page.
 */
export function RatingChip({ rating }: { rating: FeedbackRow["rating"] }) {
  const { t } = useTranslation();
  const Thumb = rating === "up" ? ThumbsUp : ThumbsDown;
  return (
    <Chip>
      <Thumb aria-hidden className="size-icon" />
      {t(`answer.rate.${rating}`)}
    </Chip>
  );
}

interface FeedbackTableProps {
  rows: readonly FeedbackRow[];
  /** Whether the list is narrowed, which an empty one says. */
  filtered: boolean;
  /** The row the reader opened, and the link's `onClick` that notes it (openedRow.ts). */
  opened: string | null;
  open: (key: string) => (event: MouseEvent) => void;
}

export function FeedbackTable({ rows, filtered, opened, open }: FeedbackTableProps) {
  const { t, i18n } = useTranslation();
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  if (rows.length === 0)
    return (
      <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
        {t(filtered ? "staff.feedback.noneMatching" : "staff.feedback.none")}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("staff.feedback.question")}</TableHead>
          <TableHead>{t("staff.feedback.rating")}</TableHead>
          <TableHead>{t("staff.feedback.reason")}</TableHead>
          <TableHead>{t("staff.feedback.target")}</TableHead>
          <TableHead>{t("staff.feedback.locale")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("staff.open")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} selected={opened === row.id} className="relative cursor-pointer">
            <TableCell>
              <Link
                to={`/staff/feedback/${row.id}`}
                onClick={open(row.id)}
                lang={row.locale}
                className="line-clamp-2 font-semibold after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {row.question}
              </Link>
              <span className="block text-caption text-muted tabular-nums">
                {t("staff.feedback.rated", { date: when.format(new Date(row.updated_at)) })}
              </span>
            </TableCell>
            <TableCell label={t("staff.feedback.rating")} className="whitespace-nowrap">
              <RatingChip rating={row.rating} />
            </TableCell>
            <TableCell label={t("staff.feedback.reason")}>
              {row.reason === "" ? (
                <span className="text-muted">—</span>
              ) : (
                <Chip>{t(`feedback.reason.${row.reason}`)}</Chip>
              )}
              {row.comment !== "" && (
                <span
                  lang={row.comment_locale || undefined}
                  className="mt-hair line-clamp-1 block text-caption text-muted"
                >
                  {row.comment}
                </span>
              )}
            </TableCell>
            <TableCell label={t("staff.feedback.target")} className="whitespace-nowrap">
              {row.target === null ? (
                <span className="text-muted">—</span>
              ) : (
                t(`staff.feedback.where.${row.target}`)
              )}
            </TableCell>
            <TableCell label={t("staff.feedback.locale")}>
              <LanguageChip locale={row.locale} />
            </TableCell>
            <TableCell>
              <span className="flex items-center justify-end text-muted">
                <ChevronRight aria-hidden className="size-icon max-sm:hidden" />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
