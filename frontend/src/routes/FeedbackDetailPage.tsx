/**
 * `/staff/feedback/:id`: one rating opened (#218), for the superuser to read
 * what went wrong. Its head is the thumb, the reason, where the answer was
 * searched, the question's language and when it was rated; then the comment,
 * in its own language; then the exchange rated, drawn as the student saw it
 * by the chat's own turn (features/chat/TurnView.tsx), the question, where it
 * was searched, the answer with its pills and its sources, so a rating is
 * never read through a second drawing of an answer; above it, folded, the
 * exchanges its question was asked with, as plain text, as the model received
 * them; and the id of the request that produced it, which files its log
 * lines. Nothing names the student or the conversation (FeedbackPage.tsx).
 *
 * The address is the rating's, its answer's id, so it opens from a link as
 * well as from the list; a rating withdrawn since, or deleted with its
 * conversation, is not found.
 */

import { ChevronRight } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { type FeedbackDetail, getFeedback } from "@/api/review";
import { useSession } from "@/auth/useSession";
import { Chip } from "@/components/ui/chip";
import { LanguageChip } from "@/features/chat/SourceParts";
import { TurnView } from "@/features/chat/TurnView";
import type { Turn } from "@/features/chat/useAsk";
import { useLoad } from "@/features/staff/context";
import { isNotFound } from "@/features/staff/errors";
import { RatingChip } from "@/features/staff/FeedbackTable";
import { PageHead, Section } from "@/features/staff/page";
import { LoadFailure } from "@/features/staff/Refusal";
import { StaffNotFound } from "./StaffLanding";
import { useCrumbs, useShell } from "./shell";

/** The exchange rated, as the chat reads a stored one back (useAsk.ts), with no thumbs to give. */
function turnOf(rating: FeedbackDetail): Turn {
  const { answer } = rating;
  return {
    key: rating.id,
    question: rating.question,
    answer: answer.text,
    citations: answer.citations,
    route: answer.route,
    searchMs: answer.search_ms,
    locale: answer.locale,
    complete: answer.complete,
    failure: answer.complete ? null : { kind: "interrupted" },
    answerId: null,
    feedback: null,
  };
}

export default function FeedbackDetailPage() {
  const { account } = useSession();
  if (account === null || !account.is_superuser) return <StaffNotFound />;
  return <Rating />;
}

function Rating() {
  const { t, i18n } = useTranslation();
  const { back } = useShell();
  const { id = "" } = useParams();
  const load = useCallback(() => getFeedback(id), [id]);
  const rating = useLoad(load);
  const { data } = rating;
  useCrumbs(
    isNotFound(rating.error)
      ? { kind: "notFound" }
      : data === null
        ? null
        : { kind: "rating", question: data.question },
  );

  if (rating.error !== null)
    return <LoadFailure error={rating.error} back={back} onRetry={() => void rating.reload()} />;
  if (data === null) return null;
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const { answer, history } = data;

  return (
    <>
      <PageHead
        heading={t("staff.feedback.rating")}
        chips={
          <>
            <RatingChip rating={data.rating} />
            {data.reason !== "" && <Chip>{t(`feedback.reason.${data.reason}`)}</Chip>}
            {answer.route !== null && (
              <Chip tone="accent">{t(`staff.feedback.where.${answer.route.target}`)}</Chip>
            )}
            <LanguageChip locale={answer.locale} />
          </>
        }
        sub={t("staff.feedback.rated", { date: when.format(new Date(data.updated_at)) })}
      />
      {data.comment !== "" && (
        <Section heading={t("staff.feedback.comment")}>
          <p
            lang={data.comment_locale || undefined}
            className="whitespace-pre-wrap rounded-card border border-line bg-surface px-snug py-tight text-body text-ink"
          >
            {data.comment}
          </p>
        </Section>
      )}
      <Section heading={t("staff.feedback.answer")}>
        {history.length > 0 && (
          <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-tight font-medium text-body text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-icon shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              />
              {t("staff.feedback.history", { count: history.length })}
            </summary>
            <p className="mt-hair text-caption text-muted">{t("staff.feedback.historyHint")}</p>
            <ol className="mt-snug ml-snug flex flex-col gap-snug border-line border-l pl-gutter text-body">
              {history.map((exchange, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the exchanges never reorder, and two may be the same
                <li key={index} className="flex flex-col gap-hair">
                  <p className="whitespace-pre-wrap font-medium text-ink">{exchange.question}</p>
                  <p className="whitespace-pre-wrap text-muted">{exchange.answer}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
        <TurnView turn={turnOf(data)} live={false} thinking={false} retry={null} visitor={false} />
      </Section>
      <dl className="flex flex-wrap items-baseline gap-tight text-caption text-muted">
        <dt>{t("staff.feedback.request")}</dt>
        <dd className={answer.request_id === "" ? undefined : "select-all font-mono text-ink"}>
          {answer.request_id === "" ? t("staff.feedback.noRequest") : answer.request_id}
        </dd>
      </dl>
    </>
  );
}
