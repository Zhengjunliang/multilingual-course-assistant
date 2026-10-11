/**
 * A panel over the page from one edge: the sidebar from the left when the
 * screen is too narrow to hold it beside the answer, and an answer's sources
 * from the right (features/chat/SourcesPanel.tsx).
 *
 * Radix rather than a hand-rolled overlay: what a drawer owes a reader is focus
 * moved into it, focus returned on close, Escape, and the rest of the page
 * hidden from a screen reader while it is open. Those are the parts that get
 * skipped when a drawer is two divs and a boolean.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read out when the drawer opens, and shown at its top when it has `closeLabel`. */
  heading: string;
  /**
   * The name of a close button. With it the drawer shows its heading and the
   * button above its content, as a panel the reader opened on purpose does;
   * without it, as the sidebar, the heading is for a screen reader only.
   */
  closeLabel?: string;
  /** The edge it comes from. The right one is the full width of a phone. */
  side?: "left" | "right";
  children: ReactNode;
}

export function Sheet({
  open,
  onOpenChange,
  heading,
  closeLabel,
  side = "left",
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/40" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 z-floating flex flex-col border-line bg-surface shadow-overlay",
            side === "left"
              ? "left-0 w-72 max-w-[85vw] border-r"
              : "slide-in-right right-0 w-full border-l sm:w-90",
          )}
        >
          {closeLabel === undefined ? (
            <Dialog.Title className="sr-only">{heading}</Dialog.Title>
          ) : (
            <div className="flex items-center justify-between gap-tight border-line border-b py-tight pr-tight pl-gutter">
              <Dialog.Title className="font-semibold text-body text-ink">{heading}</Dialog.Title>
              <Dialog.Close
                aria-label={closeLabel}
                className="grid size-control-icon place-items-center rounded-control text-muted transition-colors hover:bg-mark hover:text-ink"
              >
                <X aria-hidden className="size-icon" />
              </Dialog.Close>
            </div>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
