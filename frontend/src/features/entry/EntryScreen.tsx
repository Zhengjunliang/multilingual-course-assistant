/**
 * The entry (#173): what `/` shows before the first question, to a visitor
 * and to a signed-in reader with no conversation open. The living cat alone
 * on the grained ground, no scene behind it; the caption, a line on what it
 * answers from, and three questions to start with. The composer sits under
 * it (routes/ChatPage.tsx), and the cat's eyes rest on it when nobody moves.
 *
 * The chips are the answer to an empty room: a reader who does not already
 * know what this thing answers has nothing to go on, and the two knowledge
 * bases behind it are invisible until someone guesses a question that hits
 * one. Three of them, covering both bases on purpose — enrolment and calendar
 * come from the university pages, the course one from the slides — so the
 * first click already demonstrates what the system is for. A visitor gets a
 * campus question in place of the course one: the slides are for an account,
 * and a first click that ends in a refusal demonstrates nothing. Each wears
 * the hand-drawn outline on hover (`hover-sketch`, index.css).
 *
 * A visitor's first visit opens on the intro (intro.ts): the cat drawn in one
 * stroke, the caption written in six languages and then in the interface's,
 * and a Skip button, which hands the focus to the question box.
 *
 * A component of its own rather than a block inside ChatPage, because
 * ChatPage needs a router and a session to render and this needs neither.
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { LivingMascot } from "@/components/LivingMascot";
import { Button } from "@/components/ui/button";
import { Suggestion, Suggestions } from "@/components/ui/suggestion";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { Caption } from "./Caption";
import { useIntro } from "./intro";

const CHIPS = ["enrolment", "calendar", "material"] as const;
const VISITOR_CHIPS = ["enrolment", "calendar", "library"] as const;

interface EntryScreenProps {
  /** Picking a chip asks it, rather than typing it into the composer first. */
  onPick: (question: string) => void;
  /** Nobody is signed in, so every chip asks about the campus. */
  visitor: boolean;
}

export function EntryScreen({ onPick, visitor }: EntryScreenProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const intro = useIntro(visitor && !reduced);
  // The caption is written in once more when the intro ends, and stays so.
  const played = useRef(intro.playing);
  const caption = t("entry.caption");
  const writing = intro.playing
    ? (intro.line ?? { lang: i18n.language, text: "" })
    : played.current
      ? { lang: i18n.language, text: caption }
      : null;

  const skip = () => {
    intro.skip();
    document.getElementById("question")?.focus();
  };

  return (
    // `max-w-4xl` is the composer's own width (Composer.tsx). Without it the
    // heading centres on the screen while the chips stretch the whole column,
    // and the three things a reader looks at first sit on three different axes.
    <div className="flex w-full max-w-4xl flex-col items-center gap-room text-center">
      <div className="flex flex-col items-center gap-tight">
        <LivingMascot
          restOn="question"
          drawIn={intro.playing}
          className="w-entry-cat-sm md:w-entry-cat"
        />
        <Caption
          caption={caption}
          writing={writing}
          // A line's height even before the intro writes its first letter, so
          // nothing under the caption moves while it does.
          className="min-h-(--text-display--line-height) font-semibold font-serif text-display text-ink"
        />
        <p className="text-body text-muted">{t("app.subtitle")}</p>
      </div>

      <Suggestions className="max-w-full">
        {(visitor ? VISITOR_CHIPS : CHIPS).map((chip) => {
          const question = t(`entry.chip.${chip}`);
          return <Suggestion key={chip} suggestion={question} onClick={onPick} />;
        })}
      </Suggestions>

      {intro.playing && (
        <Button
          type="button"
          variant="ghost"
          onClick={skip}
          className="hover-sketch fixed right-gutter bottom-gutter rounded-full text-ink"
        >
          {t("entry.skip")}
        </Button>
      )}
    </div>
  );
}
