/**
 * A book as the reading list's form holds it while it is written
 * (ReadingDialog.tsx), and what the form sends: the whole book when it is
 * added, the fields edited alone when it is changed, so a field someone else
 * changed meanwhile keeps their value.
 */

import {
  BOOK_LANGUAGES,
  type Importance,
  type ReadingDraft,
  type ReadingItem,
} from "@/api/catalog";
import { languageName } from "@/i18n";

/** The fields the server may refuse, in the form's order. */
export const FIELDS = ["title", "authors", "year", "isbn", "url", "importance", "locale"] as const;
export type FieldName = (typeof FIELDS)[number];

export interface Draft {
  title: string;
  authors: string;
  year: string;
  isbn: string;
  url: string;
  importance: Importance;
  /** The language the book is written in. */
  locale: string;
}

/** The form for `book`; a new book starts in `language`, the syllabus's. */
export function draftOf(book: ReadingItem | "new", language: string): Draft {
  if (book === "new") {
    return {
      title: "",
      authors: "",
      year: "",
      isbn: "",
      url: "",
      importance: "required",
      locale: language,
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

export function sent(draft: Draft): ReadingDraft {
  const year = draft.year.trim();
  return { ...draft, year: year === "" ? null : year };
}

/** The fields of `draft` that differ from `book`. */
export function changes(book: ReadingItem, draft: Draft): Partial<ReadingDraft> {
  const before = sent(draftOf(book, book.locale));
  const after = sent(draft);
  return Object.fromEntries(
    (Object.keys(after) as (keyof ReadingDraft)[])
      .filter((field) => after[field] !== before[field])
      .map((field) => [field, after[field]]),
  );
}

/**
 * A book's language named in the interface's language `ui`, as a label on its
 * own begins ("Inglese", "Tedesco"): a reader knows a language by its name in
 * their own, and a hundred endonyms would be in scripts the reader cannot read.
 */
export function bookLanguage(locale: string, ui: string): string {
  const name = languageName(locale, ui);
  return name.charAt(0).toLocaleUpperCase(ui) + name.slice(1);
}

/** The languages a book may be written in, named as `bookLanguage` names them, in `ui`'s alphabetical order. */
export function bookLanguages(ui: string): { value: string; label: string }[] {
  const order = new Intl.Collator(ui);
  return BOOK_LANGUAGES.map((value) => ({ value, label: bookLanguage(value, ui) })).sort((a, b) =>
    order.compare(a.label, b.label),
  );
}
