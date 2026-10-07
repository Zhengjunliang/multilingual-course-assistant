/**
 * A question that interrupts, for an action that cannot be taken back without
 * another one: removing someone, deleting a conversation, switching a course's
 * current edition.
 *
 * Radix's alert dialog rather than `dialog.tsx`, because the WAI-ARIA pattern
 * differs where it matters (outside the repository: WAI-ARIA APG, "Alert and
 * Message Dialogs"): the role is `alertdialog`, the description is announced
 * with the title, a click outside does not dismiss it, and focus opens on
 * Cancel, the choice that loses nothing.
 *
 * The confirming button is a plain `Button`, not Radix's `Action`, which would
 * close the dialog on click. Here it closes only when `onConfirm` resolves to
 * true, so a refusal is shown inside the dialog that asked, and while
 * `onConfirm` runs neither Escape nor Cancel closes it: a dialog gone before the
 * server answered would say "done" about something that may not be. Both
 * buttons are off while it runs, and a browser drops the focus of a button
 * that turns off to the page, outside the dialog; after a refusal focus goes
 * to Cancel, the way out that is always on.
 *
 * Where focus lands on closing is the caller's, through Radix's own
 * `onCloseAutoFocus`: Radix returns it to the element that opened the dialog,
 * and a dialog opened from a row the action removes has no such element left.
 */

import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface AlertDialogProps {
  open: boolean;
  /** Called with false when the reader cancels, and after a confirmation that succeeded. */
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, naming the thing it happens to. Read out with the title. */
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  /** Does the thing; resolves to whether it was done, and the dialog closes only then. */
  onConfirm: () => Promise<boolean>;
  /** The warning colour on the confirming button, for an action that destroys something. */
  destructive?: boolean;
  /** Keeps the confirming button off, after a refusal that asking again would only repeat. */
  confirmDisabled?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  /** Shown above the buttons: a refusal, when there is one. */
  children?: ReactNode;
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  destructive = false,
  confirmDisabled = false,
  onCloseAutoFocus,
  children,
}: AlertDialogProps) {
  const [running, setRunning] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const refused = useRef(false);

  const confirm = async () => {
    setRunning(true);
    try {
      if (await onConfirm()) onOpenChange(false);
      else refused.current = true;
    } finally {
      setRunning(false);
    }
  };

  // Once Cancel is on again, which is the render after `running` clears.
  useEffect(() => {
    if (running || !refused.current) return;
    refused.current = false;
    cancel.current?.focus();
  }, [running]);

  return (
    <RadixAlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!running) onOpenChange(next);
      }}
    >
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className="fixed inset-0 z-backdrop bg-black/40" />
        <RadixAlertDialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-floating flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-sm flex-col gap-room overflow-y-auto rounded-card border border-line bg-surface p-gutter shadow-overlay"
        >
          <div className="flex flex-col gap-hair">
            <RadixAlertDialog.Title className="font-semibold font-serif text-ink text-title">
              {title}
            </RadixAlertDialog.Title>
            <RadixAlertDialog.Description className="text-body text-muted">
              {description}
            </RadixAlertDialog.Description>
          </div>
          {children}
          <div className="flex flex-wrap justify-end gap-tight">
            <RadixAlertDialog.Cancel asChild>
              <Button ref={cancel} type="button" variant="outline" disabled={running}>
                {cancelLabel}
              </Button>
            </RadixAlertDialog.Cancel>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              disabled={running || confirmDisabled}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
