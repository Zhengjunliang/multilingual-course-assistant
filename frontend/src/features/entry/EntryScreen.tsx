/**
 * The entry (#173): what `/` shows before the first question, to a visitor
 * and to a signed-in reader with no conversation open. The living cat on the
 * grained ground, the room (Room.tsx) behind it; the caption and a line on
 * what it answers from. The composer sits under it and the room stands around
 * both (routes/ChatPage.tsx), and the cat's eyes rest on the composer when
 * nobody moves.
 *
 * No example questions under the caption: the line names both knowledge
 * bases, and a canned question picked for the reader is rarely the one they
 * came with.
 *
 * A visitor's first visit opens on the intro (intro.ts): the cat drawn in one
 * stroke, the caption written in six languages and then in the interface's,
 * and a Skip button, which hands the focus to the question box.
 *
 * A component of its own rather than a block inside ChatPage, because
 * ChatPage needs a router and a session to render and this needs neither.
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { LivingMascot } from "@/components/LivingMascot";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/utils";
import { Caption } from "./Caption";
import { LINES, useIntro } from "./intro";

interface EntryScreenProps {
  /** Nobody is signed in: the intro plays for a visitor's first visit only. */
  visitor: boolean;
  /** Changes each time a question is sent from here, and the cat hops. */
  hops?: number;
  /**
   * The cat has just jumped here from a sign-in form (routes/landing.ts): it
   * smiles, and the caption and the line rise into place under it.
   */
  landed?: boolean;
}

export function EntryScreen({ visitor, hops = 0, landed = false }: EntryScreenProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const intro = useIntro(visitor && !reduced);
  // The caption is written in once more when the intro ends, and stays so.
  const played = useRef(intro.playing);
  const caption = t("entry.caption");
  const settled = { lang: i18n.language, text: caption };
  const writing = intro.playing
    ? (intro.line ?? { lang: i18n.language, text: "" })
    : played.current
      ? settled
      : null;
  const holds = [...LINES, settled];

  const skip = () => {
    intro.skip();
    document.getElementById("question")?.focus();
  };

  // A keyboard reader resting on Skip when the intro ends by itself would be
  // left on the page's body as the button goes; the question box takes the
  // focus instead. Cleared only when the focus moves to another element, as
  // a removed button may or may not report its blur, and acted on only when
  // the focus is indeed lost, so a reader who has moved on keeps their place.
  const onSkip = useRef(false);
  useEffect(() => {
    if (intro.playing || !onSkip.current) return;
    onSkip.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) document.getElementById("question")?.focus();
  }, [intro.playing]);

  return (
    // `max-w-4xl` is the composer's own width (Composer.tsx): a caption that
    // wraps, in a long language or on a phone, wraps within the question
    // box's edges rather than wider than the box it introduces.
    <div className="flex w-full max-w-4xl flex-col items-center gap-tight text-center">
      {/* First in the page's order, so the keyboard reaches it before the
          intro is over; fixed in the corner, so the eye finds it there, and
          lifted, so what comes after it in the page never paints over it.
          `data-intro` holds the room's drawing in until it goes (index.css). */}
      {intro.playing && (
        <Button
          type="button"
          variant="ghost"
          data-intro
          onClick={skip}
          onFocus={() => {
            onSkip.current = true;
          }}
          onBlur={(event) => {
            if (event.relatedTarget !== null) onSkip.current = false;
          }}
          className="hover-sketch fixed right-gutter bottom-gutter z-lifted rounded-full text-ink"
        >
          {t("entry.skip")}
        </Button>
      )}

      {/* Named for the view transition a sign-in lands here by: the cat on the
          sign-in card is the same name (routes/AuthLayout.tsx). */}
      <LivingMascot
        restOn="question"
        hops={hops}
        welcome={landed}
        drawIn={intro.playing}
        className="w-entry-cat-sm [view-transition-name:fumetto] md:w-entry-cat"
      />
      <Caption
        caption={caption}
        writing={writing}
        holds={holds}
        className={cn("font-semibold font-serif text-display text-ink", landed && "rise [--i:0]")}
      />
      <p className={cn("text-body text-muted", landed && "rise [--i:1]")}>{t("app.subtitle")}</p>
    </div>
  );
}
