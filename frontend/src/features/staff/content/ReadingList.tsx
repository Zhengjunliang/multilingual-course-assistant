/**
 * An edition's reading list on its page: one row per book, its title over its
 * ISBN (DESIGN.md, rule 1), its authors and year, whether it is required, and
 * the language its entry is written in. The list is not narrowed to the
 * interface's language: a title reads the same on every language's page of
 * the catalogue, which lists each book once.
 *
 * Whoever holds `edition.edit_content` adds a book from the section's head
 * and changes or removes one from its row: the form is a dialog
 * (ReadingDialog.tsx), and removing asks first. Focus goes back to the button
 * that opened either, or, when its row is gone, to «Aggiungi».
 */

import { BookMinus, ExternalLink, PenLine, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { listReadings, type ReadingItem, removeReading } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { endonym } from "@/i18n";
import { useFailure, useLoad } from "../context";
import { isForbidden, isNotFound } from "../errors";
import { Section } from "../page";
import { Forbidden, PartFailure } from "../Refusal";
import { ReadingDialog } from "./ReadingDialog";

interface ReadingListProps {
  edition: number;
  /** Whether the reader holds `edition.edit_content`. */
  editable: boolean;
  /** Reads the page again, after a write found the edition or a book gone. */
  reloadPage: () => Promise<boolean>;
}

export function ReadingList({ edition, editable, reloadPage }: ReadingListProps) {
  const { t } = useTranslation();
  const fail = useFailure();
  const load = useCallback(() => listReadings(edition), [edition]);
  const books = useLoad(load);
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
    <Section
      heading={t("staff.readings.title")}
      count={rows?.length}
      right={
        editable && (
          <Button
            ref={add}
            type="button"
            variant="outline"
            onClick={(event) => open(event, () => setEditing("new"))}
          >
            <Plus aria-hidden className="size-icon" />
            {t("staff.readings.add")}
          </Button>
        )
      }
    >
      {books.error !== null ? (
        <PartFailure onRetry={() => void books.reload()} />
      ) : rows === null ? null : rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-snug py-gutter text-body text-muted">
          {t("staff.readings.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.readings.field.title")}</TableHead>
              <TableHead>{t("staff.readings.field.authors")}</TableHead>
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
                  {book.isbn !== "" && (
                    <span className="block font-mono text-caption text-muted">{book.isbn}</span>
                  )}
                </TableCell>
                <TableCell label={t("staff.readings.field.authors")}>{book.authors}</TableCell>
                <TableCell label={t("staff.readings.year")} className="tabular-nums">
                  {book.year ?? "—"}
                </TableCell>
                <TableCell label={t("staff.readings.field.importance")}>
                  <Chip tone={book.importance === "required" ? "accent" : "neutral"}>
                    {t(`staff.readings.importance.${book.importance}`)}
                  </Chip>
                </TableCell>
                <TableCell label={t("staff.readings.field.locale")}>
                  {endonym(book.locale)}
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
    </Section>
  );
}
