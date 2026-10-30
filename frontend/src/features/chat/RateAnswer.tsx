/**
 * A student's rating of an answer: a thumb up, a thumb down, and why (#218).
 *
 * A press saves the rating, the same thumb again withdraws it, and the other
 * one replaces it (docs/decisions.md, 2026-10-30, *A student rates an answer
 * up or down*, point 1). The thumb down also opens a small form under the
 * row, as Open WebUI's does once the rating is saved: one of four reasons and
 * a comment, both optional, sent as a second save of the same rating. The
 * comment is written in the interface's language, which goes with it.
 *
 * The thumbs show what was pressed at once. The saves leave one after another,
 * in the order pressed, so the server ends with the last press; a refused one
 * puts the thumbs back to what the server holds and says so in a toast with a
 * way to try again (DESIGN.md, Components), unless a later press has already
 * replaced it. A session that ended elsewhere sends the reader to sign in. The
 * form's save is thanked for once the server has it, to a screen reader: on
 * screen the form closing and the thumb staying down say the same.
 *
 * Icons alone, named for a screen reader and in a hint, as every chat product
 * draws them; a pressed thumb is filled, in ink.
 */

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  FEEDBACK_REASONS,
  type FeedbackBody,
  type FeedbackReason,
  MAX_COMMENT_CHARS,
  rateAnswer,
  type StoredFeedback,
  withdrawRating,
} from "@/api/conversations";
import { isSessionLost } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface RateAnswerProps {
  answerId: string;
  /** The rating stored when the answer was read; `null` for none. */
  stored: StoredFeedback | null;
  /** The question the answer is to, which a failure's toast names. */
  question: string;
}

/** What a save leaves the thumbs showing, before the server says so. */
function shownAs(body: FeedbackBody | null): StoredFeedback | null {
  return body === null
    ? null
    : { rating: body.rating, reason: body.reason ?? "", comment: body.comment ?? "" };
}

export function RateAnswer({ answerId, stored, question }: RateAnswerProps) {
  const { t, i18n } = useTranslation();
  const { forget } = useSession();
  const [shown, setShown] = useState(stored);
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  // What the server holds, as its last answer said.
  const held = useRef(stored);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The press whose outcome the thumbs show; an earlier one's is spent.
  const latest = useRef(0);

  // `thanks`: the form sent it, and its arrival is said.
  const save = (body: FeedbackBody | null, thanks = false) => {
    latest.current += 1;
    const mine = latest.current;
    setShown(shownAs(body));
    setSent(false);
    queue.current = queue.current.then(async () => {
      try {
        if (body === null) {
          await withdrawRating(answerId);
          held.current = null;
        } else {
          held.current = await rateAnswer(answerId, body);
        }
        if (latest.current !== mine) return;
        setShown(held.current);
        setSent(thanks);
      } catch (error) {
        if (latest.current !== mine) return;
        setShown(held.current);
        // Why a thumb down was given is not asked of a thumb the server never took.
        if (held.current?.rating !== "down") setAsking(false);
        if (isSessionLost(error)) {
          forget();
          return;
        }
        toast.error(t("answer.rate.failed"), {
          description: question,
          action: {
            label: t("answer.rate.retry"),
            // The press again, which a thumb down alone asks why of.
            onClick: () => {
              if (body?.rating === "down" && !thanks) setAsking(true);
              save(body, thanks);
            },
          },
        });
      }
    });
  };

  const up = shown?.rating === "up";
  const down = shown?.rating === "down";

  return (
    <>
      <Tooltip content={t("answer.rate.up")}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("answer.rate.up")}
          aria-pressed={up}
          onClick={() => {
            setAsking(false);
            save(up ? null : { rating: "up" });
          }}
        >
          <ThumbsUp aria-hidden className={cn("size-icon", up && "fill-current")} />
        </Button>
      </Tooltip>
      <Tooltip content={t("answer.rate.down")}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("answer.rate.down")}
          aria-pressed={down}
          onClick={() => {
            setAsking(!down);
            save(down ? null : { rating: "down" });
          }}
        >
          <ThumbsDown aria-hidden className={cn("size-icon", down && "fill-current")} />
        </Button>
      </Tooltip>
      <span role="status" className="sr-only">
        {sent ? t("answer.rate.sent") : ""}
      </span>
      {asking && (
        <Reasons
          onSend={(reason, comment) => {
            setAsking(false);
            save(
              {
                rating: "down",
                ...(reason === null ? {} : { reason }),
                ...(comment === "" ? {} : { comment, locale: i18n.language }),
              },
              true,
            );
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}

interface ReasonsProps {
  onSend: (reason: FeedbackReason | null, comment: string) => void;
  onClose: () => void;
}

/**
 * Why the answer was rated down, on a line of its own under the row, which the
 * thumbs close so that it opens right after them. It takes
 * the focus as it opens, so a keyboard is in it at once, and gives nothing
 * back on closing: the thumb that opened it is just above.
 */
function Reasons({ onSend, onClose }: ReasonsProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [comment, setComment] = useState("");
  const form = useRef<HTMLFormElement | null>(null);
  const id = useId();

  useEffect(() => {
    form.current?.focus();
  }, []);

  const send = (event: FormEvent) => {
    event.preventDefault();
    onSend(reason, comment.trim());
  };

  return (
    <form
      ref={form}
      tabIndex={-1}
      aria-labelledby={`${id}-why`}
      onSubmit={send}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="flex basis-full flex-col gap-snug rounded-card border border-line bg-surface p-gutter shadow-raised outline-none"
    >
      <fieldset className="flex flex-col gap-tight">
        <legend id={`${id}-why`} className="mb-tight font-semibold text-body text-ink">
          {t("answer.rate.why")}
        </legend>
        <div className="flex flex-wrap gap-tight">
          {FEEDBACK_REASONS.map((key) => (
            <label
              key={key}
              className="inline-flex h-control-xs cursor-pointer items-center rounded-full border border-line bg-surface px-snug text-caption text-ink transition-colors hover:bg-hover has-checked:border-ink has-checked:bg-mark has-checked:font-semibold has-focus-visible:ring-3 has-focus-visible:ring-selected"
            >
              <input
                type="radio"
                name={`${id}-reason`}
                value={key}
                checked={reason === key}
                onChange={() => setReason(key)}
                className="sr-only"
              />
              {t(`feedback.reason.${key}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-hair">
        <label htmlFor={`${id}-comment`} className="font-semibold text-body text-ink">
          {t("answer.rate.comment")}
        </label>
        <textarea
          id={`${id}-comment`}
          value={comment}
          maxLength={MAX_COMMENT_CHARS}
          rows={3}
          onChange={(event) => setComment(event.target.value)}
          className="resize-y rounded-control border border-line bg-surface px-snug py-tight text-body text-ink outline-none transition-colors focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-selected"
        />
      </div>
      <div className="flex justify-end gap-tight">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("answer.rate.close")}
        </Button>
        <Button type="submit" size="sm">
          {t("answer.rate.send")}
        </Button>
      </div>
    </form>
  );
}
