import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AskFailed, ask } from "@/api/client";
import type { StartEvent } from "@/api/contract";
import { readAnswerEvents } from "@/api/sse";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { badgesOf, citedMarkers } from "@/lib/markers";

import { AnswerStream } from "./AnswerStream";
import { CitationList } from "./CitationList";

/**
 * One question's life.
 *
 * `queued` exists because the wait a reader actually feels starts when the POST
 * leaves, not when a 503 comes back: the server answers one question at a time
 * and makes the next one wait, so there can be a long silence before the first
 * byte. Showing nothing during it would be the dishonest part.
 */
type Turn =
  | { phase: "idle" }
  | { phase: "queued" }
  | { phase: "streaming"; start: StartEvent; text: string }
  | { phase: "done"; start: StartEvent; text: string }
  | {
      phase: "failed";
      start: StartEvent | null;
      text: string;
      detail: string;
      retryAfter: number | null;
    };

function startOf(turn: Turn): StartEvent | null {
  switch (turn.phase) {
    case "streaming":
    case "done":
    case "failed":
      return turn.start;
    default:
      return null;
  }
}

function textOf(turn: Turn): string {
  switch (turn.phase) {
    case "streaming":
    case "done":
    case "failed":
      return turn.text;
    default:
      return "";
  }
}

export function AskPanel() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [turn, setTurn] = useState<Turn>({ phase: "idle" });
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Leaving the page must stop generation, not just stop listening to it: the
  // server is suspended on a yield holding its one engine slot until the
  // connection drops.
  useEffect(() => () => abort.current?.abort(), []);

  const submit = useCallback(
    async (asked: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setHighlighted(null);
      setTurn({ phase: "queued" });

      let start: StartEvent | null = null;
      let text = "";
      let ended = false;

      try {
        const body = await ask({ question: asked }, controller.signal);
        for await (const event of readAnswerEvents(body)) {
          switch (event.name) {
            case "start":
              start = event.data;
              setTurn({ phase: "streaming", start, text });
              break;
            case "token":
              text += event.data.text;
              if (start !== null) setTurn({ phase: "streaming", start, text });
              break;
            case "end":
              ended = true;
              break;
            case "error":
              setTurn({
                phase: "failed",
                start,
                text,
                detail: event.data.detail,
                retryAfter: null,
              });
              return;
          }
        }
      } catch (error) {
        // An abort is this component's own doing; there is nobody to report to.
        if (controller.signal.aborted) return;
        const failure =
          error instanceof AskFailed
            ? { detail: error.detail, retryAfter: error.retryAfter }
            : { detail: error instanceof Error ? error.message : String(error), retryAfter: null };
        setTurn({ phase: "failed", start, text, ...failure });
        return;
      }

      // The contract makes `end` the completion signal, so a stream that simply
      // stopped is a failure even though every byte of it arrived.
      if (!ended || start === null) {
        setTurn({ phase: "failed", start, text, detail: t("error.title"), retryAfter: null });
        return;
      }
      setTurn({ phase: "done", start, text });
    },
    [t],
  );

  const busy = turn.phase === "queued" || turn.phase === "streaming";
  const start = startOf(turn);
  const text = textOf(turn);
  const badges = start === null ? [] : badgesOf(start.citations);
  const cited = turn.phase === "done" ? citedMarkers(text, badges) : null;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim().length > 0) void submit(question.trim());
        }}
      >
        <div className="flex flex-col gap-2">
          <label className="font-medium text-slate-700 text-sm" htmlFor="question">
            {t("ask.label")}
          </label>
          <Textarea
            id="question"
            value={question}
            maxLength={1000}
            placeholder={t("ask.placeholder")}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!busy && question.trim().length > 0) void submit(question.trim());
              }
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || question.trim().length === 0}>
            {t("ask.submit")}
          </Button>
          {busy && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                abort.current?.abort();
                setTurn({ phase: "idle" });
              }}
            >
              {t("ask.cancel")}
            </Button>
          )}
          {turn.phase === "queued" && (
            <span className="text-slate-500 text-sm">{t("status.queued")}</span>
          )}
        </div>
      </form>

      {turn.phase === "failed" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          <p className="font-medium">{t("error.title")}</p>
          <p>{turn.detail}</p>
          {turn.retryAfter !== null && <p>{t("error.retryAfter", { seconds: turn.retryAfter })}</p>}
        </div>
      )}

      {start !== null && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex flex-col gap-3">
            <p className="text-slate-500 text-xs">
              {t("route.label")}: {t(`route.${start.route.target}`)} · {start.route.reason}
            </p>
            <AnswerStream
              text={text}
              badges={badges}
              complete={turn.phase === "done"}
              onBadgeClick={setHighlighted}
            />
          </section>
          <aside className="flex flex-col gap-2">
            <h2 className="font-medium text-slate-700 text-sm">{t("citations.title")}</h2>
            <CitationList
              citations={start.citations}
              badges={badges}
              cited={cited}
              highlighted={highlighted}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
