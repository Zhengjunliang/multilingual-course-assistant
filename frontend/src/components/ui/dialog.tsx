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
 * `import * as RadixDialog`, not `as Dialog`: this file exports a function of
 * that name, and the shadowing is a type error rather than a subtle bug — but
 * it is one `npm run typecheck` reports rather than something found here.
 */

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible, unlike the drawer's: a dialog is a place, and it says which. */
  title: string;
  /** One line under the title. Radix wants a description or an explicit opt-out. */
  description?: string;
  /** Labels the close button for a reader who cannot see the cross. */
  closeLabel: string;
  children: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        {/* Full width with a gutter on a phone, a fixed column above that.
            `max-h` with its own scroll so a long body cannot push the close
            button off the bottom of a short screen. */}
        <RadixDialog.Content className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-sm flex-col gap-room overflow-y-auto rounded-lg border border-line bg-surface p-gutter shadow-lg">
          <div className="flex items-start justify-between gap-snug">
            <div className="flex min-w-0 flex-col gap-hair">
              <RadixDialog.Title className="font-semibold text-ink text-title">
                {title}
              </RadixDialog.Title>
              {description === undefined ? (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="text-caption text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label={closeLabel}
              className="-m-hair shrink-0 rounded-md p-hair text-muted transition-colors hover:bg-mark hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              <X aria-hidden className="size-icon-lg" />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
