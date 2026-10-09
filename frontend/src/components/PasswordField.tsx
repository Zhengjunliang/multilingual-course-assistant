/**
 * A password input whose letters the reader can show, after GOV.UK's Password
 * input: a button beside the field says "Show" or "Hide", is named for the
 * password it acts on, and a status line tells a screen reader what changed,
 * since focus stays on the button. Its words change with the state, so it
 * carries no `aria-pressed` as well: a toggle that renames itself and also
 * reports "pressed" would be read as two states that disagree.
 *
 * Hidden again, whatever the reader chose, at the two moments the letters
 * could outlive their purpose: when the form is sent, before anything reads
 * it, so no browser stores a visible password as ordinary form history; and
 * when the page is shown again from the back-forward cache, where it would
 * reappear on the screen the reader left. The send is caught in the capture
 * phase on the form, ahead of React's own submit handler, and the input's
 * type is set on the element itself, since a state update would land after
 * the event.
 *
 * Edge draws an eye of its own in a password input; index.css hides it, so
 * the field has one way to show the letters, not two.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PasswordFieldProps {
  id: string;
  /** `current-password` to sign in, `new-password` to register: what a password manager reads. */
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}

export function PasswordField({ id, autoComplete, value, onChange }: PasswordFieldProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  // Nothing to say until the reader has pressed the button once.
  const [toggled, setToggled] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const field = input.current;
    const form = field?.form ?? null;
    if (field === null) return;
    const hide = () => {
      field.type = "password";
      setShown(false);
    };
    form?.addEventListener("submit", hide, { capture: true });
    window.addEventListener("pageshow", hide);
    return () => {
      form?.removeEventListener("submit", hide, { capture: true });
      window.removeEventListener("pageshow", hide);
    };
  }, []);

  return (
    <div className="flex flex-col gap-hair">
      <div className="flex gap-tight">
        <Input
          ref={input}
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          aria-controls={id}
          aria-label={t(shown ? "auth.hidePassword" : "auth.showPassword")}
          onClick={() => {
            setShown(!shown);
            setToggled(true);
          }}
        >
          {t(shown ? "auth.hide" : "auth.show")}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {toggled ? t(shown ? "auth.passwordShown" : "auth.passwordHidden") : ""}
      </p>
    </div>
  );
}
