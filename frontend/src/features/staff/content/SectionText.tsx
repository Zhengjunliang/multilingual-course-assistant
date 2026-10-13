/**
 * One section of an edition's syllabus, in one language, read or edited in
 * place, as GitHub edits a comment: «Modifica» turns the text into a box with
 * «Annulla» and «Salva», and «Salva» sends that section alone; Escape cancels
 * too. Saving a section empty clears it, which asks first, since the text is
 * kept nowhere else. Once saved the box closes on the new text and the focus
 * goes back to «Modifica». A refusal stays in the box, with what was written,
 * or in the question when it was the clearing that was refused.
 */

import { Eraser, Pencil } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type SyllabusSection, type SyllabusSectionKey, writeSyllabus } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { languageName, type UiLocale } from "@/i18n";
import { useFailure } from "../context";
import { isForbidden, isNotFound } from "../errors";
import { Forbidden } from "../Refusal";

interface SectionTextProps {
  edition: number;
  locale: UiLocale;
  section: SyllabusSectionKey;
  /** The section's name in the interface's language. */
  name: string;
  /** Its text; empty when the section has none. */
  text: string;
  editable: boolean;
  /** Shows the section as the write answered it, its text empty once cleared, and says `message`. */
  onSaved: (row: SyllabusSection, message: string) => void;
  reloadPage: () => Promise<boolean>;
}

export function SectionText({
  edition,
  locale,
  section,
  name,
  text,
  editable,
  onSaved,
  reloadPage,
}: SectionTextProps) {
  const { t, i18n } = useTranslation();
  const fail = useFailure();
  const headingId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  /** What the box holds; null while the section is read, not edited. */
  const [draft, setDraft] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refocus = useRef(false);

  // Once the box is gone and «Modifica» is back: focus left in a removed box
  // would drop to the page.
  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    editButton.current?.focus();
  }, [draft]);

  const close = () => {
    setDraft(null);
    setForbidden(false);
    setRefusal(null);
    refocus.current = true;
  };

  /** Sends `value`, and resolves to whether the box may close. */
  const write = async (value: string): Promise<boolean> => {
    setRunning(true);
    setForbidden(false);
    setRefusal(null);
    try {
      const row = (await writeSyllabus(edition, locale, section, value)) ?? {
        locale,
        section,
        text: "",
      };
      const key = row.text === "" ? "staff.syllabus.cleared" : "staff.syllabus.saved";
      onSaved(row, t(key, { section: name }));
      close();
      return true;
    } catch (error) {
      // The edition left the reader's reach: the page reads again, and says so.
      if (isNotFound(error)) {
        await reloadPage();
        return true;
      }
      if (isForbidden(error)) setForbidden(true);
      else setRefusal(fail(error));
      // «Salva» was off while the request ran, and a browser drops the focus
      // of a button that turns off; the question, when it asked, gives its own.
      if (!clearing) area.current?.focus();
      return false;
    } finally {
      setRunning(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft === null || running) return;
    if (draft.trim() === text.trim()) close();
    else if (draft.trim() === "") setClearing(true);
    else void write(draft);
  };

  const refused = (
    <>
      {forbidden && <Forbidden permission="edition.edit_content" />}
      {refusal !== null && (
        <p role="alert" className="text-body text-warn-ink">
          {refusal}
        </p>
      )}
    </>
  );

  return (
    <li className="flex flex-col gap-tight px-snug py-gutter">
      <div className="flex min-h-control-xs items-center gap-snug">
        <h3 id={headingId} className="flex-1 font-semibold text-body text-ink">
          {name}
        </h3>
        {editable && draft === null && (
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDraft(text)}
          >
            <Pencil aria-hidden className="size-icon" />
            {t(text === "" ? "staff.syllabus.write" : "staff.edit")}
            <span className="sr-only">{` · ${name}`}</span>
          </Button>
        )}
      </div>
      {draft === null ? (
        text === "" ? (
          <p className="text-body text-muted">{t("staff.syllabus.empty")}</p>
        ) : (
          <p lang={locale} className="whitespace-pre-line text-body text-ink">
            {text}
          </p>
        )
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-tight">
          <TextArea
            ref={area}
            id={`${headingId}-text`}
            aria-labelledby={headingId}
            lang={locale}
            // The reader pressed «Modifica» to write here.
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // An Escape that ends a word an input method is composing is the method's.
              if (event.key === "Escape" && !event.nativeEvent.isComposing && !running) close();
            }}
          />
          {!clearing && refused}
          <div className="flex flex-wrap justify-end gap-tight">
            <Button type="button" variant="outline" size="sm" onClick={close} disabled={running}>
              {t("staff.cancel")}
            </Button>
            <Button type="submit" size="sm" pending={running}>
              {running ? t("staff.saving") : t("staff.save")}
            </Button>
          </div>
        </form>
      )}
      <AlertDialog
        open={clearing}
        onOpenChange={(open) => {
          if (open) return;
          setClearing(false);
          setForbidden(false);
          setRefusal(null);
        }}
        heading={t("staff.syllabus.clear.title")}
        icon={Eraser}
        description={t("staff.syllabus.clear.body", {
          section: name,
          language: languageName(locale, i18n.language),
        })}
        cancelLabel={t("staff.cancel")}
        confirmLabel={t("staff.syllabus.clear.action")}
        onConfirm={() => write("")}
        destructive
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (editButton.current ?? area.current)?.focus();
        }}
      >
        {clearing && refused}
      </AlertDialog>
    </li>
  );
}
