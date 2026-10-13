/**
 * An edition's reading list, a tab of its page: a panel whose head on the
 * tint names the list, counts it and holds «Aggiungi testo», over a table
 * with one row per book, its title over its authors, its year, whether it is
 * required, and the language the book is written in, named in the
 * interface's. The catalogue lists each book once, in its own language,
 * whatever the interface's. Where the rows stack into cards (table.tsx), the
 * panel lets its frame go, the cards being frames of their own.
 *
 * Whoever holds `edition.edit_content` adds a book from the panel's head
 * and changes or removes one from its row: the form is a dialog
 * (ReadingDialog.tsx), and removing asks first. Focus goes back to the button
 * that opened either, or, when its row is gone, to «Aggiungi testo».
 */

import { BookMinus, ExternalLink, PenLine, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type ReadingItem, removeReading } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Loaded, useFailure } from "../context";
import { isForbidden, isNotFound } from "../errors";
import { Forbidden, PartFailure } from "../Refusal";
import { ReadingDialog } from "./ReadingDialog";
import { bookLanguage } from "./readingDraft";

interface ReadingListProps {
  edition: number;
  /** The list, as the page read it: the page's tab counts its books. */
  books: Loaded<ReadingItem[]>;
  /** The language a new book starts in: the syllabus's. */
  language: string;
  /** Whether the reader holds `edition.edit_content`. */
  editable: boolean;
  /** Reads the page again, after a write found the edition or a book gone. */
  reloadPage: () => Promise<boolean>;
}

export function ReadingList({ edition, books, language, editable, reloadPage }: ReadingListProps) {
  const { t, i18n } = useTranslation();
  const fail = useFailure();
  const headingId = useId();
  const [editing, setEditing] = useState<ReadingItem | "new" | null>(null);
  const [removing, setRemoving] = useState<ReadingItem | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = (event: { currentTarget: HTMLElement }, then: () => void) => {
    opener.current = event.currentTarget;
    then();
  };

  const returnFocus = (event: Event) => {
    event.preventDefault();
    const heading = document.querySelector("main h1");
    const target = [opener.current, add.current, heading].find((element) => element?.isConnected);
    if (target instanceof HTMLElement) target.focus();
  };

  const gone = async () => {
    if (await reloadPage()) await books.reload();
  };

  const remove = async () => {
    if (removing === null) return false;
    setForbidden(false);
    setRefusal(null);
    try {
      await removeReading(edition, removing.id);
    } catch (error) {
      if (isNotFound(error)) {
        await gone();
        return true;
      }
      if (isForbidden(error)) setForbidden(true);
      else setRefusal(fail(error));
      return false;
    }
    await books.reload();
    toast.success(t("staff.readings.removed"), { description: removing.title });
    return true;
  };

  const rows = books.data;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-snug sm:gap-0 sm:overflow-hidden sm:rounded-card sm:border sm:border-line sm:bg-surface sm:shadow-raised"
    >
      <div className="flex flex-wrap items-center gap-snug sm:border-hairline sm:border-b sm:bg-tint sm:px-snug sm:py-tight">
        <h2 id={headingId} className="font-semibold text-ink text-title">
          {t("staff.readings.title")}
        </h2>
        {rows !== null && <Count value={rows.length} />}
        <span className="flex-1" />
        {editable && (
          <Button
            ref={add}
            type="button"
            variant="outline"
            onClick={(event) => open(event, () => setEditing("new"))}
          >
            <Plus aria-hidden className="size-icon" />
            {t("staff.readings.add")}
          </Button>
        )}
      </div>
      {books.error !== null ? (
        <div className="sm:p-snug">
          <PartFailure onRetry={() => void books.reload()} />
        </div>
      ) : rows === null ? null : rows.length === 0 ? (
        <p className="px-snug py-gutter text-body text-muted max-sm:rounded-card max-sm:border max-sm:border-line max-sm:bg-surface">
          {t("staff.readings.empty")}
        </p>
      ) : (
        // The panel is the frame, its head above the table's.
        <Table frameClassName="rounded-none border-0">
          <TableHeader className="[&>tr>th:first-child]:rounded-none [&>tr>th:last-child]:rounded-none">
            <TableRow>
              <TableHead>{t("staff.readings.field.title")}</TableHead>
              <TableHead>{t("staff.readings.year")}</TableHead>
              <TableHead>{t("staff.readings.field.importance")}</TableHead>
              <TableHead>{t("staff.readings.field.locale")}</TableHead>
              {editable && (
                <TableHead>
                  <span className="sr-only">{t("staff.readings.actions")}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((book) => (
              <TableRow key={book.id}>
                <TableCell>
                  <span lang={book.locale} className="block font-semibold text-ink">
                    {book.title}
                    {book.url !== "" && (
                      <a
                        href={book.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-tight inline-flex align-middle text-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <ExternalLink aria-hidden className="size-icon" />
                        <span className="sr-only">{t("staff.readings.link")}</span>
                      </a>
                    )}
                  </span>
                  <span className="mt-hair block text-caption text-muted">{book.authors}</span>
                </TableCell>
                <TableCell label={t("staff.readings.year")} className="tabular-nums">
                  {book.year ?? "—"}
                </TableCell>
                <TableCell label={t("staff.readings.field.importance")}>
                  <Chip tone={book.importance === "required" ? "accent" : "neutral"}>
                    {t(`staff.readings.importance.${book.importance}`)}
                  </Chip>
                </TableCell>
                <TableCell label={t("staff.readings.field.locale")}>
                  <Chip>{bookLanguage(book.locale, i18n.language)}</Chip>
                </TableCell>
                {editable && (
                  <TableCell>
                    <span className="flex items-center justify-end gap-tight">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => open(event, () => setEditing(book))}
                      >
                        <PenLine aria-hidden className="size-icon" />
                        {t("staff.edit")}
                        <span className="sr-only">{` · ${book.title}`}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => open(event, () => setRemoving(book))}
                      >
                        <BookMinus aria-hidden className="size-icon" />
                        {t("staff.readings.remove")}
                        <span className="sr-only">{` · ${book.title}`}</span>
                      </Button>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ReadingDialog
        edition={edition}
        book={editing}
        language={language}
        onClose={() => setEditing(null)}
        onChanged={books.reload}
        onGone={gone}
        onCloseAutoFocus={returnFocus}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (next) return;
          setRemoving(null);
          setForbidden(false);
          setRefusal(null);
        }}
        heading={t("staff.readings.removeTitle")}
        icon={BookMinus}
        description={t("staff.readings.removeBody", { title: removing?.title ?? "" })}
        cancelLabel={t("staff.cancel")}
        confirmLabel={t("staff.readings.remove")}
        onConfirm={remove}
        destructive
        onCloseAutoFocus={returnFocus}
      >
        {forbidden && <Forbidden permission="edition.edit_content" />}
        {refusal !== null && (
          <p role="alert" className="text-body text-warn-ink">
            {refusal}
          </p>
        )}
      </AlertDialog>
    </section>
  );
}
