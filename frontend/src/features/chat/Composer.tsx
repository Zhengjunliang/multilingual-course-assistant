import { type FormEvent, type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_BUSY_RETRIES, type Waiting } from "./useAsk";

/** The server's own cap (apps/qa/serializers.py); enforced here so the reader sees it coming. */
const MAX_QUESTION_CHARS = 1000;

interface ComposerProps {
  waiting: Waiting;
  onSubmit: (question: string) => void;
  onStop: () => void;
  /**
   * Centred under the empty state, or parked at the foot of a thread.
   *
   * The same component either way. Two composers — one for the first question
   * and one for the rest — would be two places for Enter, the character cap and
   * the stop button to be got right.
   */
  placement?: "hero" | "foot";
}

/**
 * The two waits that need explaining, and only those.
 *
 * Ordinary work — routing, retrieval, generation — is reported in the thread
 * itself, next to the question it belongs to (`TurnView`). What is left here is
 * the queue behind somebody else's question and the stop after it, neither of
 * which is about this question at all.
 */
function WaitingLine({ waiting }: { waiting: Waiting }) {
  const { t } = useTranslation();

  switch (waiting.phase) {
    case "retrying":
      return (
        <span className="text-body text-muted">
          {t("status.retrying", {
            seconds: waiting.seconds,
            attempt: waiting.attempt,
            total: MAX_BUSY_RETRIES,
          })}
        </span>
      );
    case "stopped":
      return (
        <span className="text-body text-warn-ink">
          {waiting.failure.kind === "reported" ? waiting.failure.detail : t("error.incomplete")}
        </span>
      );
    default:
      return null;
  }
}

export function Composer({ waiting, onSubmit, onStop, placement = "foot" }: ComposerProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");

  const busy =
    waiting.phase === "queued" || waiting.phase === "streaming" || waiting.phase === "retrying";
  const ready = question.trim().length > 0 && !busy;

  const send = () => {
    if (!ready) return;
    onSubmit(question.trim());
    setQuestion("");
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line: a question can be a paragraph,
    // and asking is the common case.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      className={cn(
        "w-full px-gutter",
        placement === "foot" ? "border-line border-t bg-canvas py-gutter" : "py-0",
      )}
      onSubmit={onFormSubmit}
    >
      {/* One rounded shell holding the field and its controls, rather than a
          bare textarea with buttons loose underneath it. The border is the
          accent once there is something to send: the only moving colour on an
          otherwise still screen, and it lands exactly where the next action is. */}
      <div
        className={cn(
          "mx-auto flex max-w-4xl flex-col gap-tight rounded-2xl border bg-surface p-snug transition-colors",
          ready ? "border-accent" : "border-line",
        )}
      >
        <label className="sr-only" htmlFor="question">
          {t("ask.label")}
        </label>
        <Textarea
          id="question"
          value={question}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={t("ask.placeholder")}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-control resize-none border-0 bg-transparent px-hair focus-visible:outline-none"
        />
        <div className="flex flex-wrap items-center gap-snug empty:hidden">
          {/* Absent rather than disabled while there is nothing to send. On the
              old palette a disabled accent button was a washed-out teal that
              still read as a button; on this one the accent is pure black, and
              `disabled:opacity-50` turns it into a grey slab with white text at
              half strength inside — unreadable, and the loudest thing on an
              otherwise empty screen. Enter still sends, and the button appears
              with the first character. */}
          {ready && (
            <Button type="submit" size="sm">
              {t("ask.submit")}
            </Button>
          )}
          {busy && (
            <Button type="button" size="sm" variant="outline" onClick={onStop}>
              {t("ask.cancel")}
            </Button>
          )}
          <WaitingLine waiting={waiting} />
        </div>
      </div>
    </form>
  );
}
