/**
 * `/staff/feedback`: how students rated the answers, newest first, for the
 * superuser to find the bad ones and read them (#218): narrowed by the
 * rating, the reason, where the answer was searched and the language the
 * question was asked in, counted, in the server's pages; a row opens the
 * rating (FeedbackDetailPage.tsx). No row names the student
 * (docs/decisions.md, 2026-10-30, *A student rates an answer up or down, and
 * only a superuser reads the ratings, without the student's name*, point 3).
 *
 * Shaped as Open WebUI's ratings in its admin panel, Evaluations → Feedback
 * (outside the repository). The filters and the page are the address's
 * query, the API's own (`?rating=down&page=2`), so Back from a rating
 * returns to the list as it was left, its row marked
 * (features/staff/openedRow.ts); a value the filters do not offer reads as
 * no filter. The list stays shown while another is read (`useLoad`'s
 * `keep`), and a filter changed goes back to the first page. The languages
 * offered are the interface's, as the pipeline names them; a question in
 * another is listed under all of them.
 *
 * Anyone else in the staff area is told the page is not found, as on the
 * accounts' page, and nothing is asked of the server.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { RouteDecision } from "@/api/contract";
import { FEEDBACK_REASONS } from "@/api/conversations";
import {
  FEEDBACK_PAGE_SIZE,
  type FeedbackQuery,
  type FeedbackRow,
  feedbackSearch,
  listFeedback,
} from "@/api/review";
import { useSession } from "@/auth/useSession";
import { Chip } from "@/components/ui/chip";
import { Select } from "@/components/ui/field";
import { useLoad } from "@/features/staff/context";
import { FeedbackTable } from "@/features/staff/FeedbackTable";
import { useOpenedRow } from "@/features/staff/openedRow";
import { PageHead, Pager } from "@/features/staff/page";
import { LoadFailure } from "@/features/staff/Refusal";
import { endonym, UI_LOCALES } from "@/i18n";
import { StaffNotFound } from "./StaffLanding";
import { useCrumbs, useShell } from "./shell";

const RATINGS: readonly FeedbackRow["rating"][] = ["up", "down"];
const TARGETS: readonly RouteDecision["target"][] = ["slides", "unifi_web", "both"];
/** The interface's languages as a question's `locale` names them: `zh`, not `zh-hans`. */
const LOCALES: readonly string[] = UI_LOCALES.map((locale) => locale.split("-")[0] ?? locale);

/** `value` when it is one of `offered`, else no filter. */
function one<T extends string>(value: string | null, offered: readonly T[]): T | "" {
  return offered.find((each) => each === value) ?? "";
}

function queryOf(search: URLSearchParams): FeedbackQuery {
  const page = Number(search.get("page"));
  return {
    rating: one(search.get("rating"), RATINGS),
    reason: one(search.get("reason"), FEEDBACK_REASONS),
    target: one(search.get("target"), TARGETS),
    locale: one(search.get("locale"), LOCALES),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export default function FeedbackPage() {
  const { account } = useSession();
  if (account === null || !account.is_superuser) return <StaffNotFound />;
  return <Ratings />;
}

function Ratings() {
  const { t } = useTranslation();
  const { back } = useShell();
  const [search, setSearch] = useSearchParams();
  const query = queryOf(search);
  const { rating, reason, target, locale, page } = query;
  const load = useCallback(
    () => listFeedback({ rating, reason, target, locale, page }),
    [rating, reason, target, locale, page],
  );
  const ratings = useLoad(load, { keep: true });
  const { opened, open } = useOpenedRow(ratings.data !== null);
  useCrumbs({ kind: "feedback" });

  if (ratings.error !== null)
    return <LoadFailure error={ratings.error} back={back} onRetry={() => void ratings.reload()} />;
  if (ratings.data === null) return null;
  const { count, results, previous, next } = ratings.data;
  /** The list narrowed by `change`, from its first page. */
  const narrow = (change: Partial<FeedbackQuery>) =>
    setSearch(feedbackSearch({ ...query, ...change, page: 1 }));
  const all = (key: string) => ({ value: "", label: t(key) });

  return (
    <>
      <PageHead
        heading={t("staff.feedback.title")}
        chips={<Chip tone="accent">{t("staff.feedback.count", { count })}</Chip>}
        sub={t("staff.feedback.sub")}
      />
      <div className="flex flex-col gap-snug">
        <div className="flex flex-wrap gap-snug">
          <Select
            id="feedback-rating"
            label={t("staff.feedback.rating")}
            value={rating}
            onChange={(event) => narrow({ rating: one(event.target.value, RATINGS) })}
            options={[
              all("staff.feedback.allRatings"),
              ...RATINGS.map((value) => ({ value, label: t(`answer.rate.${value}`) })),
            ]}
            className="min-w-0 flex-1 basis-40"
          />
          <Select
            id="feedback-reason"
            label={t("staff.feedback.reason")}
            value={reason}
            onChange={(event) => narrow({ reason: one(event.target.value, FEEDBACK_REASONS) })}
            options={[
              all("staff.feedback.allReasons"),
              ...FEEDBACK_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
            ]}
            className="min-w-0 flex-1 basis-40"
          />
          <Select
            id="feedback-target"
            label={t("staff.feedback.target")}
            value={target}
            onChange={(event) => narrow({ target: one(event.target.value, TARGETS) })}
            options={[
              all("staff.feedback.allTargets"),
              ...TARGETS.map((value) => ({ value, label: t(`staff.feedback.where.${value}`) })),
            ]}
            className="min-w-0 flex-1 basis-40"
          />
          <Select
            id="feedback-locale"
            label={t("staff.feedback.locale")}
            value={locale}
            onChange={(event) => narrow({ locale: one(event.target.value, LOCALES) })}
            options={[
              all("staff.feedback.allLocales"),
              ...LOCALES.map((value) => ({ value, label: endonym(value), lang: value })),
            ]}
            className="min-w-0 flex-1 basis-40"
          />
        </div>
        <FeedbackTable
          rows={results}
          filtered={feedbackSearch({ ...query, page: 1 }) !== ""}
          opened={opened}
          open={open}
        />
        <Pager
          page={page}
          count={count}
          size={FEEDBACK_PAGE_SIZE}
          previous={previous !== null}
          next={next !== null}
          onPage={(to) => setSearch(feedbackSearch({ ...query, page: to }))}
        />
      </div>
    </>
  );
}
