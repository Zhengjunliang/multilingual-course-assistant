/**
 * «Aiuto e scorciatoie»: every key the signed-in interface answers to, in one
 * list (#191), as ChatGPT's and Linear's shortcut sheets are. Opened from the
 * account menu and from `?` outside a field.
 *
 * The shell's four come from features/chat/shortcuts.ts, so a key changed
 * there changes here; the question box's two and Escape are written beside
 * them, since a list that left them out would not be every key. Each row is a
 * term and its keys, a description list, which a screen reader reads as pairs.
 */

import { Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { FILTER, shortcuts } from "@/features/chat/shortcuts";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes back to: the dialog is opened from state, so Radix has no trigger to return it to. */
  onCloseAutoFocus?: (event: Event) => void;
}

export function ShortcutsDialog({ open, onOpenChange, onCloseAutoFocus }: ShortcutsDialogProps) {
  const { t } = useTranslation();
  const keys = shortcuts();
  const rows: [string, string][] = [
    [t("shortcuts.newConversation"), keys.newConversation.label],
    [t("shortcuts.search"), keys.search.label],
    [t("shortcuts.settings"), keys.settings.label],
    [t("shortcuts.help"), keys.help.label],
    [t("shortcuts.filter"), FILTER.label],
    [t("shortcuts.send"), t("keys.enter")],
    [t("shortcuts.newLine"), `${t("keys.shift")} ${t("keys.enter")}`],
    [t("shortcuts.close"), t("keys.escape")],
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      heading={t("account.help")}
      icon={Keyboard}
      closeLabel={t("account.close")}
    >
      <dl className="flex flex-col">
        {rows.map(([action, key]) => (
          <div
            key={action}
            className="flex items-center gap-snug border-hairline border-b py-tight last:border-b-0"
          >
            <dt className="flex-1 text-body text-ink">{action}</dt>
            {/* The cap is hidden from a screen reader (kbd.tsx), which reads the keys here instead. */}
            <dd>
              <Kbd>{key}</Kbd>
              <span className="sr-only">{key}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
