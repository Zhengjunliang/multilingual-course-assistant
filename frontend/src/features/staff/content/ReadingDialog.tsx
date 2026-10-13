/**
 * Adding a book to an edition's reading list, or changing one: every field of
 * the book in one form, as the catalogue's Testi lists it.
 *
 * The server is the one that knows what it takes, so the form checks nothing
 * itself: each refused field says why under itself, by its code, and the
 * first of them takes the focus; a title the list already holds in that
 * language is one of them. The dialog stays open while the request runs and
 * after a refusal, as the assign dialog does (features/staff/AssignDialog.tsx).
 * A change sends only the fields the reader edited, so a field someone else
 * changed meanwhile keeps their value. A 404 means the book, or the edition,
 * went away since the page was read: the dialog closes, and what is left is
 * read again.
 */

import { BookPlus, PenLine } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  addReading,
  changeReading,
  type Importance,
  type ReadingDraft,
  type ReadingItem,
} from "@/api/catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { DEFAULT_UI_LOCALE, endonym, UI_LOCALES, type UiLocale } from "@/i18n";
import { useFailure } from "../context";
import { fieldErrorKey, isForbidden, isNotFound } from "../errors";
import { Forbidden } from "../Refusal";

/** The fields the server may refuse, in the form's order. */
const FIELDS = ["title", "authors", "year", "isbn", "url", "importance", "locale"] as const;
type FieldName = (typeof FIELDS)[number];

interface Draft {
  title: string;
  authors: string;
  year: string;
  isbn: string;
  url: string;
  importance: Importance;
  locale: UiLocale;
}

function draftOf(book: ReadingItem | "new"): Draft {
  if (book === "new") {
    return {
      title: "",
      authors: "",
      year: "",
      isbn: "",
      url: "",
      importance: "required",
      locale: DEFAULT_UI_LOCALE,
    };
  }
  return {
    title: book.title,
    authors: book.authors,
    year: book.year === null ? "" : String(book.year),
    isbn: book.isbn,
    url: book.url,
    importance: book.importance,
    locale: book.locale,
  };
}

function sent(draft: Draft): ReadingDraft {
  const year = draft.year.trim();
  return { ...draft, year: year === "" ? null : year };
}

/** The fields of `draft` that differ from `book`. */
function changes(book: ReadingItem, draft: Draft): Partial<ReadingDraft> {
  const before = sent(draftOf(book));
  const after = sent(draft);
  return Object.fromEntries(
    (Object.keys(after) as (keyof ReadingDraft)[])
      .filter((field) => after[field] !== before[field])
      .map((field) => [field, after[field]]),
  );
}

interface ReadingDialogProps {
  edition: number;
  /** The book to change, `"new"` for one to add; null while the dialog is closed. */
  book: ReadingItem | "new" | null;
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
  onClose,
  onChanged,
  onGone,
  onCloseAutoFocus,
}: ReadingDialogProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const id = useId();
  const [shownFor, setShownFor] = useState<ReadingItem | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf("new"));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [running, setRunning] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // A dialog opened for another book starts from that book.
  if (book !== shownFor) {
    setShownFor(book);
    if (book !== null) {
      setDraft(draftOf(book));
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
      const refused = Object.fromEntries(
        FIELDS.map((field) => [field, fieldErrorKey(error, field)])
          .filter((entry): entry is [FieldName, string] => entry[1] !== null)
          .map(([field, key]) => [field, t(key)]),
      );
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
      <Choice id={`${id}-locale`} label={t("staff.readings.field.locale")} error={errors.locale}>
        <ToggleGroup
          label={t("staff.readings.field.locale")}
          value={draft.locale}
          onValueChange={(value) => set("locale", value)}
          options={UI_LOCALES.map((value) => ({ value, label: endonym(value) }))}
        />
      </Choice>
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
