/**
 * A password field (components/LineField.tsx) whose letters the reader can
 * show, by an eye inside the field, after Microsoft Edge's own reveal button
 * and Material 3's secure text field. The eye is a toggle button: one name
 * that never changes, "Show password", and `aria-pressed` saying whether the
 * letters are shown, as Adrian Roselli has toggle buttons (outside the
 * repository). A screen reader announces the new state itself, so the field
 * needs no status line.
 *
 * Pressing the eye with a pointer leaves the focus in the input, as Edge's
 * does, so the reader goes on typing where they were; from the keyboard the
 * eye is a stop of its own after the input.
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
 *
 * While the input has the focus and Caps Lock is on, a chip under it says
 * so, as macOS's and Windows' sign-in fields do (#190): a password typed in
 * capitals is refused with nothing on the screen to say why. A browser tells
 * the state only with a key or pointer event, so the chip appears at the
 * first key pressed, and leaves with the focus. It is a polite live region,
 * heard once when it appears.
 *
 * The field and its eye are marked `data-mascot-away`: while the focus is in
 * either, the living cat looks away (components/LivingMascot.tsx), so this
 * field need not know the cat exists.
 */

import { ArrowBigUp, Eye, EyeOff } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { LineField } from "@/components/LineField";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

interface PasswordFieldProps {
  id: string;
  label: string;
  /** `current-password` to sign in, `new-password` to register: what a password manager reads. */
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  /** The password was refused: the field's line turns the warning colour. */
  invalid?: boolean;
  /** The ids of what tells the reader about this password: a hint, a refusal. */
  describedBy?: string;
}

export function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  invalid = false,
  describedBy,
}: PasswordFieldProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const readCapsLock = (event: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState("CapsLock"));

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

  const Icon = shown ? EyeOff : Eye;
  return (
    <div data-mascot-away>
      <LineField
        ref={input}
        id={id}
        label={label}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={readCapsLock}
        onKeyUp={readCapsLock}
        onBlur={() => setCapsLock(false)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        trailing={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 bottom-hair"
            aria-controls={id}
            aria-label={t("auth.showPassword")}
            aria-pressed={shown}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setShown(!shown)}
          >
            <Icon aria-hidden className="size-icon-lg" />
          </Button>
        }
      />
      <div aria-live="polite">
        {capsLock && (
          <Chip className="mt-tight">
            <ArrowBigUp aria-hidden className="size-icon" />
            {t("auth.capsLock")}
          </Chip>
        )}
      </div>
    </div>
  );
}
