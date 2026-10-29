import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { APP_NAME } from "@/brand/fumetto";
import type { FormRefusal } from "@/components/FormRefusal";
import { LineField } from "@/components/LineField";
import { LivingMascot } from "@/components/LivingMascot";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { Spinner } from "@/components/ui/spinner";
import { Room } from "@/features/entry/Room";
import { chooseUiLocale, UI_LOCALES, type UiLocale } from "@/i18n";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/utils";
import type { Phase } from "./landing";

/** A refused form, after the macOS sign-in window: one shake, dying out. */
const SHAKE: Keyframe[] = [
  { transform: "none" },
  { transform: "translateX(-9px)" },
  { transform: "translateX(8px)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(3px)" },
  { transform: "none" },
];

interface AuthLayoutProps {
  heading: string;
  /** The form, on the card. */
  children: ReactNode;
  /** The line under the card: the way to the other form. */
  footer: ReactNode;
  /** Changes each time the server refuses the form, and the card shakes. */
  refusals: number;
  /**
   * Where the form stands (routes/landing.ts): once it is accepted the cat
   * smiles, and crouches when it is about to jump to the entry.
   */
  phase: Phase;
}

/**
 * The frame around the two forms that come before a session (#183), and the
 * pages of a forgotten password, a reset link and an invitation: the
 * form on a card with no border, lifted by `shadow-overlay`, the living cat's
 * head sitting on the card's top edge, its chin on the edge and the bubble's
 * tail hooked over it, as the author chose on a prototype after Darin
 * Senneff's Yeti sign-in and Telegram Web's monkey. The cat is the entry's
 * (#173), alive and as large, with no intro: the sign-in screens are the
 * entry's other door. Its eyes rest on the username when nobody moves, and it
 * answers the form (components/LivingMascot.tsx): a refusal is the card's
 * shake and the cat's frown at once, an acceptance its smile.
 *
 * The language switch is here as well as in the application header, and it has
 * to be: before a login there is no account to read `User.locale` from, and a
 * student who cannot read the login page cannot get past it. This one
 * remembers the choice on this screen only (i18n/index.ts), never on an
 * account, even for a reader the invitation page finds signed in: an
 * account's language is the account menu's (components/AccountMenu.tsx).
 *
 * Behind it all stands the room (features/entry/Room.tsx), kept clear of the
 * card's column; on a phone, under it.
 *
 * The cat and the card are named for the view transition that takes an
 * accepted form to the entry (routes/landing.ts): the cat flies, the card
 * falls away.
 *
 * The cat's width is `--cat` on the column, so the card can tuck under its
 * chin by the same fraction of it at either size: the drawing's chin is 12 of
 * its 76 units of width above its bottom edge.
 */
export function AuthLayout({ heading, children, footer, refusals, phase }: AuthLayoutProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const card = useRef<HTMLDivElement>(null);

  // Only a change counts: a form that opens has been refused by nobody.
  const refusalsSeen = useRef(refusals);
  useEffect(() => {
    if (refusals === refusalsSeen.current) return;
    refusalsSeen.current = refusals;
    if (!reduced) card.current?.animate?.(SHAKE, { duration: 440, easing: "ease-out" });
  }, [refusals, reduced]);

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center px-gutter py-room">
      <Room clear="calc(25rem + 2 * var(--spacing-room))" />
      <div className="relative flex w-full max-w-100 flex-col items-center [--cat:var(--spacing-entry-cat-sm)] md:[--cat:var(--spacing-entry-cat)]">
        <LivingMascot
          restOn="username"
          refusals={refusals}
          welcome={phase === "accepted" || phase === "crouching"}
          className={cn(
            "relative z-lifted w-(--cat) [view-transition-name:fumetto]",
            phase === "crouching" && "crouch",
          )}
        />
        <div
          ref={card}
          className="mt-[calc(var(--cat)*-12/76)] flex [view-transition-name:auth-card] w-full flex-col gap-room rounded-bubble bg-surface px-room pt-[calc(var(--cat)*4/76+var(--spacing-room))] pb-room shadow-overlay md:px-8.5"
        >
          <div className="flex flex-col items-center gap-hair text-center">
            <h1 className="font-semibold text-display text-ink">{APP_NAME}</h1>
            <p className="text-body text-muted">{heading}</p>
          </div>
          {children}
        </div>
        <div className="mt-room text-center text-body text-muted">{footer}</div>
        <LocaleSwitch
          className="mt-tight"
          locales={UI_LOCALES}
          value={i18n.language}
          label={t("account.language")}
          hint={t("account.languageHint")}
          onChange={(locale: UiLocale) => void chooseUiLocale(locale)}
        />
      </div>
    </div>
  );
}

/**
 * The form's pill: its label, with an arrow sliding in under the pointer or
 * the focus; a spinner while the server decides and a check, drawn in, once it
 * accepts, after Stripe Checkout's pay button. The label stays in the button,
 * unseen, so its name never changes. With reduced motion it keeps its label
 * throughout: a spinner that cannot turn says nothing.
 */
export function AuthButton({ phase, children }: { phase: Phase; children: string }) {
  const reduced = useReducedMotion();
  const turning = phase === "busy" && !reduced;
  const accepted = (phase === "accepted" || phase === "crouching") && !reduced;
  return (
    <Button
      type="submit"
      size="lg"
      aria-disabled={phase !== "idle"}
      aria-busy={phase === "busy"}
      data-mascot-cheer
      data-mascot-busy={phase === "busy" || undefined}
      className="group relative h-auto rounded-full py-gutter aria-disabled:cursor-progress"
    >
      <span className={cn("inline-flex items-center", (turning || accepted) && "opacity-0")}>
        {children}
        <ArrowRight
          aria-hidden
          className="h-icon w-0 -translate-x-tight opacity-0 transition-[width,margin,opacity,translate] duration-base ease-emphasized group-hover:ml-tight group-hover:w-icon group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ml-tight group-focus-visible:w-icon group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
      </span>
      {turning && <Spinner className="absolute inset-0 m-auto size-icon-lg" />}
      {accepted && (
        <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 m-auto size-icon-lg">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="draw-in"
          />
        </svg>
      )}
    </Button>
  );
}

const HINT = "password-hint";

interface NewAccountFieldsProps {
  username: string;
  password: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  /** Built on the fields `username` and `password`, which are also the inputs' ids. */
  refusal: FormRefusal;
}

/**
 * The two fields an account is made with, by registering or by accepting an
 * invitation: the username, and the password with the hint of its rules,
 * each with the refusals the server said of it.
 */
export function NewAccountFields({
  username,
  password,
  onUsername,
  onPassword,
  refusal,
}: NewAccountFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-tight">
        <LineField
          id="username"
          label={t("auth.username")}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => onUsername(event.target.value)}
          aria-invalid={refusal.refused("username") || undefined}
          aria-describedby={refusal.describedBy("username")}
        />
        {refusal.lines("username")}
      </div>
      <div className="flex flex-col gap-tight">
        <PasswordField
          id="password"
          label={t("auth.password")}
          autoComplete="new-password"
          value={password}
          onChange={onPassword}
          invalid={refusal.refused("password")}
          describedBy={refusal.describedBy("password", HINT)}
        />
        <p id={HINT} className="text-caption text-muted">
          {t("auth.passwordHint")}
        </p>
        {refusal.lines("password")}
      </div>
    </>
  );
}
