/**
 * What is happening to the question being answered, in words: a busy server
 * being waited out, or an answer that stopped (#193).
 *
 * TurnView.tsx shows them in its banners, and routes/ChatPage.tsx says them
 * to a screen reader through one live region on the page, there from the
 * entry on, before they happen. A live region inserted with its words already
 * in it is not reliably announced (MDN, ARIA live regions), and a banner is
 * inserted with them; so would a turn's own region be, since the thread
 * mounts only once the entry has receded, after a first question may already
 * have been refused.
 */

import type { TFunction } from "i18next";

import { MAX_BUSY_RETRIES, type Turn } from "./useAsk";

/** The server refused the question as busy: it is asked again in `seconds`, for the `attempt`th time. */
export interface Retry {
  seconds: number;
  attempt: number;
}

/** When the question is asked again, and which try that is. */
export function retryText(retry: Retry, t: TFunction): string {
  return t("status.retrying", { ...retry, total: MAX_BUSY_RETRIES });
}

/**
 * Why an answer stopped, the server's words or that it was cut short, and,
 * for a signed-in reader with part of an answer, that the part is stored
 * (docs/api.md); `null` for an answer that did not fail.
 */
export function failureText(
  turn: Turn,
  visitor: boolean,
  t: TFunction,
): { heading: string; kept: string | undefined } | null {
  if (turn.failure === null) return null;
  return {
    heading: turn.failure.kind === "reported" ? turn.failure.detail : t("error.incomplete"),
    kept: !visitor && turn.answer !== "" ? t("answer.kept") : undefined,
  };
}

/**
 * What a screen reader is told about the turn being answered: its banner's
 * words while it is retried or once it has failed just now, and nothing for a
 * failure read back with a stored conversation.
 */
export function spokenNotice(
  turn: Turn,
  retry: Retry | null,
  failedNow: boolean,
  visitor: boolean,
  t: TFunction,
): string {
  if (retry !== null) return `${t("status.busy")} ${retryText(retry, t)}`;
  const failed = failedNow ? failureText(turn, visitor, t) : null;
  if (failed === null) return "";
  return failed.kept === undefined ? failed.heading : `${failed.heading} ${failed.kept}`;
}
