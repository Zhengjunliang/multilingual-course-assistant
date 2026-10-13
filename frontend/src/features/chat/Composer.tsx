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
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { Waiting } from "./useAsk";

interface ComposerProps {
  waiting: Waiting;
  onSubmit: (question: string) => void;
  onStop: () => void;
  /**
   * The conversation the question goes to, `null` for a new one. What the foot
   * said about an empty press is let go when it changes: the key for a new
   * conversation changes the page without the field ever being left.
   */
  conversation?: number | null;
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

export function Composer({
  waiting,
  onSubmit,
  onStop,
  conversation = null,
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
  // The send button was pressed with nothing to send: the foot says so until
  // the next keystroke, until the field is left, so that a second press,
  // which takes the focus off the field first, is announced again, or until
  // the conversation changes, so that the hint does not follow the reader.
  const [missing, setMissing] = useState(false);
  // The conversation last drawn, to notice the change while drawing rather
  // than in an effect a frame later (react.dev, "Adjusting some state when a
  // prop changes").
  const [drawnFor, setDrawnFor] = useState(conversation);
  if (drawnFor !== conversation) {
    setDrawnFor(conversation);
    setMissing(false);
  }

  const send = () => {
    if (!ready) return;
    onSubmit(question.trim());
    setQuestion("");
  };

  // The button never turns off to say there is nothing to send (DESIGN.md,
  // Do's and Don'ts): pressed on an empty field, it puts the caret there and
  // says what is missing. Enter on an empty field does nothing, as in a
  // message box.
  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready && !busy) {
      setMissing(true);
      field.current?.focus();
      return;
    }
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
            in it. The button stays at the foot as the question grows, where
            the caret is. */}
        <div className="flex items-end gap-snug">
          <textarea
            ref={field}
            id="question"
            rows={1}
            value={question}
            maxLength={MAX_QUESTION_CHARS}
            placeholder={t("ask.placeholder")}
            onChange={(event) => {
              setQuestion(event.target.value);
              setMissing(false);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setMissing(false)}
            className="field-sizing-content max-h-[40vh] min-h-control-icon min-w-0 flex-1 resize-none bg-transparent px-hair py-tight text-body text-ink outline-none placeholder:text-muted"
          />
          {/* One round button that says what it does, as the prototype of
              #193 draws it: «Chiedi» and an arrow, and «Ferma» and a square
              while an answer is on its way. With nothing to send it is
              outlined rather than filled, the accent kept for the moment
              there is a question. `data-mascot-cheer`: the living cat smiles
              while the pointer is on it (components/LivingMascot.tsx). */}
          {busy ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={onStop}>
              <Square aria-hidden className="size-3 fill-current" />
              {t("ask.cancel")}
            </Button>
          ) : (
            <Button
              type="submit"
              variant={ready ? "primary" : "outline"}
              className="rounded-full"
              data-mascot-cheer
            >
              {t("ask.submit")}
              <ArrowUp aria-hidden className="size-icon" />
            </Button>
          )}
        </div>
        {/* The foot: what is missing after an empty press, the answer being
            written, or else the keys, which a touch screen has not got. The
            keys are a reminder for the eye: Enter and Shift+Enter are in the
            list of keys (ShortcutsDialog.tsx), which a screen reader reaches,
            so the caps are hidden from it here as everywhere (kbd.tsx). */}
        <p className="flex min-h-icon-lg flex-wrap items-center gap-tight px-hair text-caption text-muted">
          <span role="status" className={missing ? "" : "sr-only"}>
            {missing ? t("ask.empty") : ""}
          </span>
          {!missing && waiting.phase === "streaming" && (
            <>
              <Spinner />
              {t("status.streaming")}
            </>
          )}
          {!missing && !busy && (
            <span aria-hidden className="flex items-center gap-hair pointer-coarse:hidden">
              <Kbd>{t("keys.enter")}</Kbd>
              {t("ask.toSend")}
              <span className="px-hair">·</span>
              <Kbd>{`${t("keys.shift")} ${t("keys.enter")}`}</Kbd>
              {t("ask.toBreak")}
            </span>
          )}
        </p>
      </div>
    </form>
  );
}
