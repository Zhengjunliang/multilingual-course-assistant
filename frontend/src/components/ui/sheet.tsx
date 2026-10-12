/**
 * A panel over the page from one edge: the sidebar from the left when the
 * screen is too narrow to hold it beside the answer, and an answer's sources
 * from the right (features/chat/SourcesPanel.tsx).
 *
 * Radix rather than a hand-rolled overlay: what a drawer owes a reader is focus
 * moved into it, focus returned on close, Escape, and the rest of the page
 * hidden from a screen reader while it is open. Those are the parts that get
 * skipped when a drawer is two divs and a boolean.
 *
 * A panel with a visible head may carry a count after its heading, such as
 * how many sources it lists (#190, rule 5).
 */

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Count } from "@/components/ui/count";
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
  /** After the visible heading: how many things the panel holds. */
  count?: number;
  /** The edge it comes from. The right one is the full width of a phone. */
  side?: "left" | "right";
  /**
   * The button that opens it, drawn where the sheet is. Radix returns focus
   * only to a `Trigger` of its own, and marks it `aria-expanded`; a sheet
   * opened from state alone leaves focus on the page's body when it closes.
   */
  trigger?: ReactElement;
  children: ReactNode;
}

export function Sheet({
  open,
  onOpenChange,
  heading,
  closeLabel,
  count,
  side = "left",
  trigger,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
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
            <div className="flex items-center gap-tight border-line border-b py-tight pr-tight pl-gutter">
              <Dialog.Title className="font-semibold text-body text-ink">{heading}</Dialog.Title>
              {count !== undefined && <Count value={count} />}
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={closeLabel}
                  className="ml-auto"
                >
                  <X aria-hidden className="size-icon" />
                </Button>
              </Dialog.Close>
            </div>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
