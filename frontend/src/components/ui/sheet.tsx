/**
 * The sidebar, when the screen is too narrow to hold it beside the answer.
 *
 * Radix rather than a hand-rolled overlay: what a drawer owes a reader is focus
 * moved into it, focus returned on close, Escape, and the rest of the page
 * hidden from a screen reader while it is open. Those are the parts that get
 * skipped when a drawer is two divs and a boolean.
 */

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read out when the drawer opens; it has no visible heading of its own. */
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onOpenChange, title, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-line border-r bg-surface shadow-lg">
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
