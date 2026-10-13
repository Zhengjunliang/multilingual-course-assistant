/**
 * The address of a link in a syllabus section, asked for in a dialog when the
 * editor's link button or its key is pressed (SyllabusEditor.tsx).
 *
 * An address without a scheme is read as https, as a browser's address bar
 * reads it, and what is then not an absolute http(s) URL is refused under the
 * field (`safeUrl`, the rule the rendered text follows). A link the cursor is
 * in can be removed from here.
 *
 * The dialog is a form inside the section's form, through React's tree if not
 * the page's: its submit stops at its own form, or the section would be saved
 * with it.
 */

import { Link2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { safeUrl } from "@/features/chat/AnswerMarkdown";

/** The address the hint and the refusal show as an example. */
const EXAMPLE = "https://www.unifi.it";

interface LinkDialogProps {
  /** The address the cursor's link has, empty for a new link; null while the dialog is closed. */
  href: string | null;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
  /** Gives the focus back to the text. */
  onCloseAutoFocus: (event: Event) => void;
}

export function LinkDialog({
  href,
  onApply,
  onRemove,
  onClose,
  onCloseAutoFocus,
}: LinkDialogProps) {
  const { t } = useTranslation();
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [refused, setRefused] = useState(false);

  // A dialog opened again starts from the link it was opened on.
  if (href !== shownFor) {
    setShownFor(href);
    if (href !== null) {
      setValue(href);
      setRefused(false);
    }
  }

  return (
    <Dialog
      open={href !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      heading={t("staff.syllabus.editor.linkTitle")}
      icon={Link2}
      closeLabel={t("staff.cancel")}
      onCloseAutoFocus={onCloseAutoFocus}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const trimmed = value.trim();
        const address = safeUrl(trimmed) ?? safeUrl(`https://${trimmed}`);
        if (address === undefined) setRefused(true);
        else onApply(address);
      }}
      footer={
        <>
          {href !== null && href !== "" && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={onRemove}>
              {t("staff.syllabus.editor.linkRemove")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {t("staff.cancel")}
          </Button>
          <Button type="submit">{t("staff.syllabus.editor.linkApply")}</Button>
        </>
      }
    >
      <Field
        id="syllabus-link-address"
        label={t("staff.syllabus.editor.linkField")}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        // Where the reader types the moment the dialog opens.
        autoFocus
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setRefused(false);
        }}
        hint={t("staff.syllabus.editor.linkHint", { example: EXAMPLE })}
        error={refused ? t("staff.syllabus.editor.linkInvalid", { example: EXAMPLE }) : undefined}
        announce
      />
    </Dialog>
  );
}
