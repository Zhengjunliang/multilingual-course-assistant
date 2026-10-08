/**
 * What a reader sees before they have asked anything.
 *
 * It used to be one line of small grey text. That is not restraint, it is an
 * empty room: a reader who does not already know what this thing answers has
 * nothing to go on, and the two knowledge bases behind it are invisible until
 * someone guesses a question that happens to hit one.
 *
 * The chips are that answer. Three of them, covering both bases on purpose —
 * enrolment and calendar come from the university pages, the course one from
 * the slides — so the first click a reader makes already demonstrates the thing
 * the system is for. A visitor gets a campus question in place of the course
 * one: the slides are for an account, and a first click that ends in a refusal
 * demonstrates nothing.
 *
 * A separate component rather than a block inside ChatPage, because ChatPage
 * needs a router and a session to render and this needs neither. Testing the
 * empty state through the page would mean standing up two providers to look at
 * a heading.
 */

import { useTranslation } from "react-i18next";

import { Mascot } from "@/components/Mascot";
import { Suggestion, Suggestions } from "@/components/ui/suggestion";

const CHIPS = ["enrolment", "calendar", "material"] as const;
const VISITOR_CHIPS = ["enrolment", "calendar", "library"] as const;

interface EmptyStateProps {
  /** Picking a chip asks it, rather than typing it into the composer first. */
  onPick: (question: string) => void;
  /** Nobody is signed in, so every chip asks about the campus. */
  visitor: boolean;
}

export function EmptyState({ onPick, visitor }: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    // `max-w-4xl` is the composer's own width (Composer.tsx). Without it the
    // heading centres on the screen while the chips stretch the whole column,
    // and the three things a reader looks at first sit on three different axes.
    <div className="flex w-full max-w-4xl flex-col items-center gap-room text-center">
      <div className="flex flex-col items-center gap-tight">
        <Mascot pose="welcome" className="size-mascot" />
        <h2 className="font-semibold font-serif text-display text-ink">{t("empty.title")}</h2>
        <p className="text-body text-muted">{t("app.subtitle")}</p>
      </div>

      <Suggestions className="max-w-full">
        {(visitor ? VISITOR_CHIPS : CHIPS).map((chip) => {
          const question = t(`empty.chip.${chip}`);
          return <Suggestion key={chip} suggestion={question} onClick={onPick} />;
        })}
      </Suggestions>
    </div>
  );
}
