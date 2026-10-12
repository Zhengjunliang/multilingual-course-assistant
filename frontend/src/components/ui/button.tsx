/**
 * A button, and the classes of one for a link that looks like a button: it
 * goes somewhere rather than doing something.
 *
 * Five variants (#190). `primary` is the accent, filled, for the one thing a
 * screen asks for; `soft` its tint, for a second action that still belongs
 * to the accent; `outline` and `ghost` for the rest; `warn` confirms that
 * something will be destroyed, in the warning's tint and ink, never a solid
 * red, which would shout louder than the primary beside it. Hover is the
 * accent at 6 %, focus a 2 px ring in it (index.css, `--hover`).
 *
 * Three sizes, 28, 32 and 40 px, with 32 the default, and two squares for an
 * icon alone. `pending` is the button's own request on its way: a spinner
 * before the words, which the caller turns into the action's verb in
 * progress ("Assegnazione…"), and the button off until it ends, so it is not
 * sent twice; that is the only reason a button is ever disabled (DESIGN.md,
 * Do's and Don'ts). It keeps its colour while it waits, since a faded button
 * reads as one that cannot act. `shortcut` shows the key that does the same,
 * on the cap and in `aria-keyshortcuts` (`kbd.tsx` says why both).
 */

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { Kbd, type Shortcut } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-tight whitespace-nowrap rounded-control font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-raised hover:bg-accent/90",
        soft: "border border-accent-line bg-accent-soft text-accent hover:bg-selected",
        outline: "border border-line bg-surface text-ink shadow-raised hover:bg-hover",
        ghost: "text-muted hover:bg-hover hover:text-ink",
        // The one variant with a hue of its own: the one index.css keeps for
        // a failure and for destroying something (docs/decisions.md).
        warn: "border border-warn-line bg-warn text-warn-ink hover:border-warn-ink",
      },
      size: {
        sm: "h-control-xs px-tight text-caption",
        md: "h-control-sm px-snug text-body",
        lg: "h-control px-gutter text-body",
        icon: "size-control-icon",
        "icon-sm": "size-control-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** The button's own request is on its way. */
    pending?: boolean;
    shortcut?: Shortcut;
  };

export function Button({
  className,
  variant,
  size,
  pending = false,
  shortcut,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      aria-keyshortcuts={shortcut?.keys}
      className={cn(
        buttonVariants({ variant, size }),
        pending && "disabled:opacity-100",
        className,
      )}
    >
      {pending && <Spinner />}
      {children}
      {shortcut !== undefined && <Kbd tone="inherit">{shortcut.label}</Kbd>}
    </button>
  );
}
