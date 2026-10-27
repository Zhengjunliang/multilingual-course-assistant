/**
 * Adding a book to an edition's reading list, or changing one: every field of
 * the book in one form, as the catalogue's Testi lists it.
 *
 * The server is the one that knows what it takes, so the form checks nothing
 * itself: each refused field says why under itself, by its code, and the
 * first of them takes the focus; a title the list already holds is one of
 * them. The language is the book's own, chosen from every language the server
 * knows, named in the interface's (readingDraft.ts); a new book starts in the
 * syllabus's. The dialog stays open while the request runs and
 * after a refusal, as the assign dialog does (features/staff/AssignDialog.tsx).
 * A change sends only the fields the reader edited (readingDraft.ts). A 404 means the book, or the edition,
 * went away since the page was read: the dialog closes, and what is left is
 * read again.
 */

import { BookPlus, PenLine } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { addReading, changeReading, type ReadingItem } from "@/api/catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, Select } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { describeError } from "@/lib/errorText";
import { useFailure } from "../context";
import { isForbidden, isNotFound } from "../errors";
import { Forbidden } from "../Refusal";
import {
  bookLanguages,
  changes,
  type Draft,
  draftOf,
  FIELDS,
  type FieldName,
  sent,
} from "./readingDraft";

interface ReadingDialogProps {
  edition: number;
  /** The book to change, `"new"` for one to add; null while the dialog is closed. */
  book: ReadingItem | "new" | null;
  /** The language a new book starts in: the syllabus's. */
  language: string;
  onClose: () => void;
  /** Reads the list again after a write. */
  onChanged: () => Promise<unknown>;
  /** Reads what is left after a 404: the page, and then the list. */
  onGone: () => Promise<unknown>;
  onCloseAutoFocus: (event: Event) => void;
}

export function ReadingDialog({
  edition,
  book,
  language,
  onClose,
  onChanged,
  onGone,
  onCloseAutoFocus,
}: ReadingDialogProps) {
  const { t, i18n } = useTranslation();
  const fail = useFailure();
  const id = useId();
  const languages = useMemo(() => bookLanguages(i18n.language), [i18n.language]);
  const [shownFor, setShownFor] = useState<ReadingItem | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf("new", language));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [running, setRunning] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // A dialog opened for another book starts from that book.
  if (book !== shownFor) {
    setShownFor(book);
    if (book !== null) {
      setDraft(draftOf(book, language));
      setErrors({});
      setForbidden(false);
      setRefusal(null);
    }
  }

  const set = (field: keyof Draft, value: string) => {
    setDraft((shown) => ({ ...shown, [field]: value }));
    setErrors((shown) => ({ ...shown, [field]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (book === null || running) return;
    const changed = book === "new" ? null : changes(book, draft);
    if (changed !== null && Object.keys(changed).length === 0) {
      onClose();
      return;
    }
    setRunning(true);
    setErrors({});
    setForbidden(false);
    setRefusal(null);
    try {
      const saved =
        book === "new" || changed === null
          ? await addReading(edition, sent(draft))
          : await changeReading(edition, book.id, changed);
      await onChanged();
      toast.success(t(book === "new" ? "staff.readings.added" : "staff.readings.changed"), {
        description: saved.title,
      });
      onClose();
    } catch (error) {
      if (isNotFound(error)) {
        await onGone();
        if (book !== "new") toast(t("staff.readings.gone", { title: book.title }));
        onClose();
        return;
      }
      const { fieldSentences } = describeError(error, { shownFields: FIELDS });
      const refused: Partial<Record<FieldName, string>> = {};
      for (const field of FIELDS) {
        const sentence = fieldSentences[field]?.[0];
        if (sentence !== undefined) refused[field] = t(sentence.key, sentence.values);
      }
      const first = FIELDS.find((field) => refused[field] !== undefined);
      if (first !== undefined) {
        setErrors(refused);
        document.getElementById(`${id}-${first}`)?.focus();
      } else if (isForbidden(error)) setForbidden(true);
      else setRefusal(fail(error));
    } finally {
      setRunning(false);
    }
  };

  const field = (name: "title" | "authors" | "year" | "isbn" | "url") => ({
    id: `${id}-${name}`,
    value: draft[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) => set(name, event.target.value),
  });

  return (
    <Dialog
      open={book !== null}
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
      heading={t(book === "new" ? "staff.readings.addTitle" : "staff.readings.editTitle")}
      description={book === null || book === "new" ? undefined : book.title}
      icon={book === "new" ? BookPlus : PenLine}
      closeLabel={t("staff.cancel")}
      onCloseAutoFocus={onCloseAutoFocus}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={running}>
            {t("staff.cancel")}
          </Button>
          <Button
            type="submit"
            pending={running}
            shortcut={{ keys: "Enter", label: t("keys.enter") }}
          >
            {running ? t("staff.saving") : t("staff.save")}
          </Button>
        </>
      }
    >
      <Field
        {...field("title")}
        label={t("staff.readings.field.title")}
        // Where a reader expects to type the moment the dialog opens.
        autoFocus
        autoComplete="off"
      />
      <Field
        {...field("authors")}
        label={t("staff.readings.field.authors")}
        hint={t("staff.readings.field.authorsHint")}
        autoComplete="off"
      />
      <Field
        {...field("year")}
        label={t("staff.readings.field.year")}
        inputMode="numeric"
        autoComplete="off"
        className="tabular-nums"
      />
      <Field
        {...field("isbn")}
        label={t("staff.readings.field.isbn")}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
      />
      <Field
        {...field("url")}
        label={t("staff.readings.field.url")}
        type="url"
        autoComplete="off"
        spellCheck={false}
      />
      <Choice
        id={`${id}-importance`}
        label={t("staff.readings.field.importance")}
        error={errors.importance}
      >
        <ToggleGroup
          label={t("staff.readings.field.importance")}
          value={draft.importance}
          onValueChange={(value) => set("importance", value)}
          options={(["required", "recommended"] as const).map((value) => ({
            value,
            label: t(`staff.readings.importance.${value}`),
          }))}
        />
      </Choice>
      <Select
        id={`${id}-locale`}
        label={t("staff.readings.field.locale")}
        value={draft.locale}
        error={errors.locale}
        onChange={(event) => set("locale", event.target.value)}
        options={languages}
      />
      {forbidden && <Forbidden permission="edition.edit_content" />}
      {refusal !== null && (
        <p role="alert" className="text-body text-warn-ink">
          {refusal}
        </p>
      )}
    </Dialog>
  );
}

/** A choice of a few options under its label, its refusal under it, as a field's. */
function Choice({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div id={id} tabIndex={-1} className="flex flex-col gap-hair outline-none">
      {/* The group's own name is `label`; this is its visible twin. */}
      <span aria-hidden className="font-semibold text-body text-ink">
        {label}
      </span>
      {children}
      {error !== undefined && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
