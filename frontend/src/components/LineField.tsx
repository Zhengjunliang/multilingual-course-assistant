/**
 * A field drawn as an underline with its label inside, after Material 3's
 * filled text field and Apple ID's sign-in: the label sits where the text
 * will go and floats up, to four fifths of its size, once the field has the
 * focus, a value or a password manager's fill; an accent line grows from the
 * left over the underline while the focus is anywhere in the field, its
 * trailing button included, and turns the warning colour while the field is
 * `aria-invalid`.
 *
 * The underline at rest is `muted`, not `line`: with no box around the input
 * it is the field's only edge, which WCAG 1.4.11 holds to 3:1, as Material 3
 * draws its own indicator at rest in a high-contrast grey. The text is 16 px,
 * the size below which Safari on iOS zooms into a field on focus.
 *
 * `placeholder=" "` is what lets CSS tell an empty field from a filled one
 * (`:placeholder-shown`); the label, not a placeholder, says what goes in.
 * Chrome paints a filled field pale blue, which an inset `box-shadow` of the
 * card's own colour covers. The label floats and the line grows without a
 * transition under reduced motion: they change at once.
 */

import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface LineFieldProps extends Omit<ComponentProps<"input">, "placeholder"> {
  id: string;
  label: string;
  /** A button inside the field at its end, such as a password's eye. */
  trailing?: ReactNode;
}

export function LineField({ id, label, trailing, className, ...input }: LineFieldProps) {
  return (
    <div
      className={cn(
        "relative after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-slow after:ease-emphasized focus-within:after:scale-x-100 has-[[aria-invalid=true]]:after:scale-x-100 has-[[aria-invalid=true]]:after:bg-warn-ink motion-reduce:after:transition-none",
        className,
      )}
    >
      <input
        id={id}
        placeholder=" "
        className={cn(
          "peer w-full border-0 border-muted border-b bg-transparent pt-room pb-tight text-ink text-reading outline-none autofill:shadow-[inset_0_0_0_10rem_var(--surface)] autofill:[-webkit-text-fill-color:var(--ink)]",
          trailing !== undefined && "pr-control",
        )}
        {...input}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute bottom-tight left-0 origin-bottom-left text-muted text-reading transition-[transform,color] duration-base ease-emphasized peer-autofill:-translate-y-room peer-autofill:scale-80 peer-focus:-translate-y-room peer-focus:scale-80 peer-focus:text-accent peer-[:not(:placeholder-shown)]:-translate-y-room peer-[:not(:placeholder-shown)]:scale-80 motion-reduce:transition-none"
      >
        {label}
      </label>
      {trailing}
    </div>
  );
}
