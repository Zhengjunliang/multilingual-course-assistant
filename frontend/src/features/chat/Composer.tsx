import { ArrowUp, Square } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { MAX_QUESTION_CHARS } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_BUSY_RETRIES, type Waiting } from "./useAsk";

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
  /**
   * Where the field's top stood under the entry, given once, as the composer
   * moves to the foot: the box travels from there (`travel`, index.css)
   * rather than jumping. A new object each time, so each first question
   * travels.
   */
  travelFrom?: { top: number } | null;
  /** The entry has just been landed on from a sign-in form: the box rises into place. */
  rise?: boolean;
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

export function Composer({
  waiting,
  onSubmit,
  onStop,
  placement = "foot",
  travelFrom = null,
  rise = false,
}: ComposerProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [travelling, setTravelling] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // What the composer mounted with is a travel some earlier composer made:
  // the page keeps it, and a composer mounted again after a conversation that
  // could not be read must not slide from there.
  const travelled = useRef(travelFrom);

  // Measured after the move and before it is painted: the distance from
  // where the field stands now to where it stood is where the box starts.
  useLayoutEffect(() => {
    if (travelFrom === travelled.current) return;
    travelled.current = travelFrom;
    if (travelFrom === null || field.current === null || box.current === null) return;
    const distance = travelFrom.top - field.current.getBoundingClientRect().top;
    if (distance === 0) return;
    box.current.style.setProperty("--travel-from", `${distance}px`);
    setTravelling(true);
  }, [travelFrom]);

  // Cut short as well as ended, by reduced motion switched on halfway: a
  // class left behind would make the next travel find it already set and
  // never start. React has no prop for `animationcancel`.
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const cancelled = (event: AnimationEvent) => {
      if (event.animationName === "travel") setTravelling(false);
    };
    element.addEventListener("animationcancel", cancelled);
    return () => element.removeEventListener("animationcancel", cancelled);
  }, []);

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
    // Under the entry the column around it already keeps the gutter, so the
    // box is as wide there as at the foot and travels without changing width.
    <form
      className={cn(
        "relative w-full",
        placement === "foot" && "border-line border-t bg-ground p-gutter",
        rise && "rise [--i:2]",
      )}
      onSubmit={onFormSubmit}
    >
      {/* One shell holding the field and its button, rather than a bare
          textarea with a button loose beside it. It wears the pill
          (`bg-pill`, index.css), the material the interface inherits from
          the question box, in the composer's own corners rather than a pill's
          round ends, which would clip a question of several lines. A border
          appears in the accent once there is something to send, as the send
          button takes its fill: the only moving colour on an otherwise still
          screen, and it lands exactly where the next action is. */}
      <div
        ref={box}
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-tight rounded-bubble border bg-pill p-snug transition-colors",
          ready ? "border-accent" : "border-transparent",
          travelling && "travel",
        )}
        onAnimationEnd={(event) => {
          if (event.animationName === "travel") setTravelling(false);
        }}
      >
        <label className="sr-only" htmlFor="question">
          {t("ask.label")}
        </label>
        {/* The field and its button on one line, as in a message box: one
            line tall until the question is longer, then growing with it
            (`field-sizing-content`) up to `max-h-[40vh]`, where it scrolls;
            a browser without `field-sizing` keeps the one line and scrolls
            in it. The field is as tall as the button (`min-h-control-icon`),
            so one line of text and the arrow share a centre, and the button
            stays at the foot as the question grows, where the caret is. */}
        <div className="flex items-end gap-snug">
          <Textarea
            ref={field}
            id="question"
            rows={1}
            value={question}
            maxLength={MAX_QUESTION_CHARS}
            placeholder={t("ask.placeholder")}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onKeyDown}
            className="field-sizing-content max-h-[40vh] min-h-control-icon min-w-0 flex-1 resize-none border-0 bg-transparent px-hair focus-visible:outline-none"
          />
          {/* One round button, as ChatGPT, Claude and Gemini keep theirs: an
              arrow that sends, and a square that stops while an answer is
              being written. With nothing to send the arrow
              is quiet, the mark's grey with a muted glyph, rather than
              `disabled:opacity-50`, which turns the accent fill into a faded
              slab, the loudest thing on an otherwise empty screen. Enter
              sends either way. `data-mascot-cheer`: the living cat smiles
              while the pointer is on it (components/LivingMascot.tsx), and
              a disabled button takes no pointer. */}
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-full"
              onClick={onStop}
              aria-label={t("ask.cancel")}
            >
              <Square aria-hidden className="size-icon fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!ready}
              className="rounded-full disabled:bg-mark disabled:text-muted disabled:opacity-100 disabled:shadow-none"
              aria-label={t("ask.submit")}
              data-mascot-cheer
            >
              <ArrowUp aria-hidden className="size-icon-lg" />
            </Button>
          )}
        </div>
        <WaitingLine waiting={waiting} />
      </div>
    </form>
  );
}
