/**
 * A field of a form in a page or a dialog: its label above it, the box with
 * an optional icon at its start, then what helps, a hint, a refusal, a count
 * of what is left (#190). The sign-in card's fields are drawn another way,
 * `components/LineField.tsx`, and share the refusal, `FieldError`.
 *
 * One component for the five parts, because each page used to assemble them
 * itself and no two refused the same way. The hint and the refusal are tied
 * to the input by `aria-describedby`, the refusal first, and the input says
 * `aria-invalid` while it is refused, as the WAI tutorial on forms asks
 * (outside the repository: WAI, "User Notification"). A refusal says what was
 * wrong and how to put it right, after an icon, so it reads without colour.
 *
 * The focus is the box's: its edge turns to the accent and a 3 px ring of
 * `--selected` grows round it, so the ring follows the box rather than the
 * bare input inside it. A refused box keeps the warning's edge, focused or
 * not, its ring a tint of the same. `announce` makes the refusal an alert,
 * for a form that refuses after it is sent while the focus stays where it
 * was: moving the focus back to a field that already has it reads nothing.
 *
 * `SearchField` is the box alone, for a filter: a magnifier, no visible label
 * (its name is `aria-label`, since the magnifier says what it is for) and the
 * key that reaches it. `TextArea` is the box alone over several lines, for
 * text written in place under the heading that names it (`aria-labelledby`),
 * a section of a syllabus: it grows with its text (`field-sizing-content`)
 * from six lines to most of the screen, where it scrolls.
 *
 * `Select` is one of a list, as `Field` lays it out: the browser's own
 * `select` in the field's box, as GitHub's Primer draws its Select (outside
 * the repository: Primer, "Select"), so a phone opens its own picker and the
 * keyboard does what every select does. An option may say its language
 * (`lang`), for a list of languages each named in its own.
 */

import { ChevronDown, CircleAlert, type LucideIcon, Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Kbd, type Shortcut } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const BOX =
  "flex items-center gap-tight rounded-control border bg-surface text-muted transition-colors focus-within:ring-3";
const CALM = "border-line focus-within:border-accent focus-within:ring-selected";
const REFUSED = "border-warn-line focus-within:ring-warn-line/25";
const INPUT =
  "min-w-0 flex-1 self-stretch bg-transparent text-body text-ink outline-none placeholder:text-muted";

interface FieldErrorProps {
  id?: string;
  /**
   * `alert` for a refusal that must be heard as it appears: one no field's
   * description carries, or one shown while the focus stays in its field
   * (`Field`'s `announce`).
   */
  role?: "alert";
  children: ReactNode;
}

/** What was refused, in the warning's ink after an icon, under the field it is about. */
export function FieldError({ id, role, children }: FieldErrorProps) {
  return (
    <p id={id} role={role} className="flex items-start gap-tight text-body text-warn-ink">
      <CircleAlert aria-hidden className="mt-hair size-icon shrink-0" />
      <span>{children}</span>
    </p>
  );
}

interface FieldProps extends Omit<ComponentProps<"input">, "id"> {
  id: string;
  label: string;
  icon?: LucideIcon;
  hint?: string;
  /** What was refused and how to put it right. */
  error?: string;
  /** Reads the refusal out as it appears. */
  announce?: boolean;
  /** Shows how much of `maxLength` the value uses; the field must be controlled. */
  counter?: boolean;
}

export function Field({
  id,
  label,
  icon: Icon,
  hint,
  error,
  announce = false,
  counter = false,
  className,
  ...input
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [
    error === undefined ? undefined : errorId,
    hint === undefined ? undefined : hintId,
    input["aria-describedby"],
  ]
    .filter((part) => part !== undefined)
    .join(" ");
  // UTF-16 units, as `maxLength` counts them.
  const length = typeof input.value === "string" ? input.value.length : 0;

  return (
    <div className="flex flex-col gap-hair">
      <label htmlFor={id} className="font-semibold text-body text-ink">
        {label}
      </label>
      <div className={cn(BOX, "h-control px-snug", error === undefined ? CALM : REFUSED)}>
        {Icon !== undefined && <Icon aria-hidden className="size-icon shrink-0" />}
        <input
          {...input}
          id={id}
          aria-invalid={error === undefined ? input["aria-invalid"] : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          className={cn(INPUT, className)}
        />
      </div>
      {error !== undefined && (
        <FieldError id={errorId} role={announce ? "alert" : undefined}>
          {error}
        </FieldError>
      )}
      {hint !== undefined && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
      {counter && input.maxLength !== undefined && (
        <p className="self-end text-caption text-muted tabular-nums">
          {length} / {input.maxLength}
        </p>
      )}
    </div>
  );
}

interface SearchFieldProps extends Omit<ComponentProps<"input">, "type"> {
  /** The field's name, read out in place of a visible label. */
  label: string;
  shortcut?: Shortcut;
}

export function SearchField({ label, shortcut, className, ...input }: SearchFieldProps) {
  return (
    <div className={cn(BOX, CALM, "h-control-icon pr-hair pl-tight", className)}>
      <Search aria-hidden className="size-icon shrink-0" />
      <input
        {...input}
        type="search"
        aria-label={label}
        aria-keyshortcuts={shortcut?.keys}
        className={INPUT}
      />
      {shortcut !== undefined && <Kbd>{shortcut.label}</Kbd>}
    </div>
  );
}

export function TextArea({ className, ...area }: ComponentProps<"textarea">) {
  return (
    <div className={cn(BOX, CALM, "items-stretch px-snug py-tight", className)}>
      <textarea
        {...area}
        className={cn(INPUT, "field-sizing-content max-h-[60vh] min-h-[6lh] resize-y")}
      />
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
  /** The language the label is written in, when it is not the page's. */
  lang?: string;
}

interface SelectProps extends Omit<ComponentProps<"select">, "id" | "children"> {
  id: string;
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  /** What was refused and how to put it right. */
  error?: string;
}

export function Select({ id, label, options, hint, error, className, ...select }: SelectProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [
    error === undefined ? undefined : errorId,
    hint === undefined ? undefined : hintId,
  ]
    .filter((part) => part !== undefined)
    .join(" ");

  return (
    <div className={cn("flex flex-col gap-hair", className)}>
      <label htmlFor={id} className="font-semibold text-body text-ink">
        {label}
      </label>
      <div className={cn(BOX, "relative h-control", error === undefined ? CALM : REFUSED)}>
        <select
          {...select}
          id={id}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          className={cn(INPUT, "cursor-pointer appearance-none pr-control pl-snug")}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} lang={option.lang}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-snug size-icon" />
      </div>
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
      {hint !== undefined && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
