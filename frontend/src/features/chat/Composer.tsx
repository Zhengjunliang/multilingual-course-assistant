import { type FormEvent, type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BUSY_RETRIES, type Waiting } from "./useAsk";

/** The server's own cap (apps/qa/serializers.py); enforced here so the reader sees it coming. */
const MAX_QUESTION_CHARS = 1000;

interface ComposerProps {
  waiting: Waiting;
  onSubmit: (question: string) => void;
  onStop: () => void;
}

/**
 * What the reader is told while nothing is on screen.
 *
 * "Queued" is not a euphemism here: one question is answered at a time, so the
 * silence before the first token is a real queue and saying so beats a spinner
 * that implies work is happening for them specifically.
 */
function WaitingLine({ waiting }: { waiting: Waiting }) {
  const { t } = useTranslation();

  switch (waiting.phase) {
    case "queued":
      return <span className="text-muted text-sm">{t("status.queued")}</span>;
    case "retrying":
      return (
        <span className="text-muted text-sm">
          {t("status.retrying", {
            seconds: waiting.seconds,
            attempt: waiting.attempt,
            total: MAX_BUSY_RETRIES,
          })}
        </span>
      );
    case "stopped":
      return (
        <span className="text-warn-ink text-sm">
          {waiting.failure.kind === "reported" ? waiting.failure.detail : t("error.incomplete")}
        </span>
      );
    default:
      return null;
  }
}

export function Composer({ waiting, onSubmit, onStop }: ComposerProps) {
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
      className="flex flex-col gap-3 border-line border-t bg-canvas px-4 py-4"
      onSubmit={onFormSubmit}
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
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!ready}>
          {t("ask.submit")}
        </Button>
        {busy && (
          <Button type="button" variant="outline" onClick={onStop}>
            {t("ask.cancel")}
          </Button>
        )}
        <WaitingLine waiting={waiting} />
      </div>
    </form>
  );
}
