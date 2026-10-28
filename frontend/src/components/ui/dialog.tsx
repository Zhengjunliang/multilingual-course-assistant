/**
 * A window in the middle of the screen, for a settled decision.
 *
 * The same Radix package as `sheet.tsx` and not a duplicate of it: a drawer is
 * anchored to an edge and holds navigation a reader passes through, a dialog is
 * centred and holds something they came to do and will finish. They differ in
 * where they sit, how wide they are and how they leave, which is enough that
 * folding them into one component with a `side` prop would produce a component
 * whose body is an `if`.
 *
 * Drawn in three parts (#190): a head with the action's icon in a tinted
 * disc, its title and, under it, the object it acts on, the two levels of
 * rule 1; a body; and a foot on `--tint` behind a hairline, holding the
 * buttons, so the decision sits apart from what it is about. 440 px wide,
 * the width of a form's field and its hint. A dialog that is a form takes
 * `onSubmit`: the body and the foot are then one `<form>`, so the foot's
 * submit button and Enter in a field send it, and the primary button may show
 * Enter (`Button`'s `shortcut`).
 *
 * `import * as RadixDialog`, not `as Dialog`: this file exports a function of
 * that name, and the shadowing is a type error rather than a subtle bug — but
 * it is one `npm run typecheck` reports rather than something found here.
 */

import * as RadixDialog from "@radix-ui/react-dialog";
import { type LucideIcon, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible, unlike the drawer's: a dialog is a place, and it says which. */
  heading: string;
  /** The object the dialog acts on, one line under the heading. */
  description?: string;
  /** The action's icon, in the tinted disc at the head. */
  icon?: LucideIcon;
  /**
   * The warning's tint on the disc, for a form that destroys something, as
   * `AlertDialog`'s `destructive`; its submit button, in the footer, takes `warn`.
   */
  warn?: boolean;
  /** Labels the close button for a reader who cannot see the cross. */
  closeLabel: string;
  /** The buttons, in the tinted foot. */
  footer?: ReactNode;
  /** Makes the body and the foot one form, sent by its submit button or by Enter. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /**
   * Where focus goes on closing. Radix returns it only to a `Trigger` of its
   * own, so a dialog opened from state says where it came from.
   */
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}

/** The disc at a dialog's head, in the accent's tint or, for destroying something, the warning's. */
export function DialogDisc({ icon: Icon, warn = false }: { icon: LucideIcon; warn?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-control-icon shrink-0 place-items-center rounded-control ring-1 ring-inset",
        warn
          ? "bg-warn text-warn-ink ring-warn-line"
          : "bg-accent-soft text-accent ring-accent-line",
      )}
    >
      <Icon className="size-icon-lg" />
    </span>
  );
}

/** The foot of a dialog: its buttons at the end, on the tint behind a hairline. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-tight border-hairline border-t bg-tint px-room py-snug">
      {children}
    </div>
  );
}

export function Dialog({
  open,
  onOpenChange,
  heading,
  description,
  icon,
  warn = false,
  closeLabel,
  footer,
  onSubmit,
  onCloseAutoFocus,
  children,
}: DialogProps) {
  const body = (
    <>
      <div className="flex min-h-0 flex-col gap-gutter overflow-y-auto px-room pb-room">
        {children}
      </div>
      {footer !== undefined && <DialogFooter>{footer}</DialogFooter>}
    </>
  );
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-backdrop bg-black/40" />
        {/* Full width with a gutter on a phone, 440 px above that. `max-h`
            with the body's own scroll, so a long body cannot push the head
            or the buttons off a short screen. */}
        <RadixDialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-floating flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-110 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
        >
          <div className="flex items-start gap-snug px-room pt-room pb-gutter">
            {icon !== undefined && <DialogDisc icon={icon} warn={warn} />}
            <div className="flex min-w-0 flex-1 flex-col gap-hair">
              <RadixDialog.Title className="font-semibold text-ink text-title">
                {heading}
              </RadixDialog.Title>
              {description === undefined ? (
                <RadixDialog.Description className="sr-only">{heading}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="text-body text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={closeLabel}>
                <X aria-hidden className="size-icon" />
              </Button>
            </RadixDialog.Close>
          </div>
          {onSubmit === undefined ? (
            body
          ) : (
            <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-col">
              {body}
            </form>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
