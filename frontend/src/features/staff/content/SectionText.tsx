/**
 * One section of an edition's syllabus, the panel its vertical tab shows: a
 * head on the tint with where the section stands among the seven («3 di 7»),
 * its name and «Modifica», then its text rendered from Markdown
 * (SyllabusMarkdown.tsx), or, when it has none, a panel saying so.
 *
 * It is read or edited in place, as GitHub edits a comment: «Modifica» turns
 * the text into the editor (SyllabusEditor.tsx, loaded then) in a box with
 * «Annulla» and «Salva», and «Salva» sends that section alone, as Markdown.
 * Ctrl Enter saves and Escape in the text cancels, unless an input method is
 * composing a word: the key that ends a word is the method's. Saving a
 * section empty clears it, which asks first, since the text is kept nowhere
 * else. Once saved the box closes on the new text and the focus goes back to
 * «Modifica». A refusal stays in the box, with what was written, or in the
 * question when it was the clearing that was refused.
 *
 * Should the editor's chunk not load, a stale page after a deploy, the text
 * is written as the Markdown it is in a plain box (MarkdownArea.tsx).
 */

import { Eraser, FileText, Pencil } from "lucide-react";
import { type FormEvent, lazy, Suspense, useId } from "react";
import { useTranslation } from "react-i18next";

import type { SyllabusSection, SyllabusSectionKey } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { onApple } from "@/features/chat/shortcuts";
import type { UiLocale } from "@/i18n";
import { Forbidden, WriteFailure } from "../Refusal";
import { MarkdownArea } from "./MarkdownArea";
import { SyllabusMarkdown } from "./SyllabusMarkdown";
import { useSectionDraft, WRITING } from "./sectionDraft";

const SyllabusEditor = lazy(() =>
  import("./SyllabusEditor").catch(() => ({ default: MarkdownArea })),
);

interface SectionTextProps {
  edition: number;
  /** The language the syllabus is written in. */
  locale: UiLocale;
  section: SyllabusSectionKey;
  /** Where it stands among the sections, from 1, and how many there are. */
  position: number;
  total: number;
  /** The section's name in the interface's language. */
  name: string;
  /** Its text; empty when the section has none. */
  text: string;
  editable: boolean;
  /** Shows the section as the write answered it, its text empty once cleared, and says `message`. */
  onSaved: (row: SyllabusSection, message: string) => void;
  /** Told whenever the box holds what the section's text does not, or no longer does. */
  onUnsaved: (section: SyllabusSectionKey, unsaved: boolean) => void;
  reloadPage: () => Promise<boolean>;
}

export function SectionText({
  edition,
  locale,
  section,
  position,
  total,
  name,
  text,
  editable,
  onSaved,
  onUnsaved,
  reloadPage,
}: SectionTextProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const {
    editButton,
    box,
    draft,
    setDraft,
    readBack,
    rich,
    running,
    clearing,
    forbidden,
    refusal,
    close,
    send,
    keys,
    clear,
    keep,
  } = useSectionDraft({ edition, section, name, text, onSaved, onUnsaved, reloadPage });
  const apple = onApple();

  const refused = (
    <>
      {forbidden && <Forbidden permission="edition.edit_content" />}
      {refusal !== null && <WriteFailure text={refusal} />}
    </>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-snug gap-y-hair border-hairline border-b bg-tint py-snug pr-gutter pl-room">
        <span className="text-caption text-muted tabular-nums">
          {t("staff.syllabus.position", { position, total })}
        </span>
        <h2 id={headingId} className="flex-1 font-semibold text-ink text-title">
          {name}
        </h2>
        {editable && draft === null && (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft(text)}
          >
            <Pencil aria-hidden className="size-icon" />
            {t(text === "" ? "staff.syllabus.write" : "staff.edit")}
            <span className="sr-only">{` · ${name}`}</span>
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-snug px-room py-room">
        {draft === null ? (
          text === "" ? (
            <Empty
              visual={<FileText className="size-icon-lg" />}
              heading={t("staff.syllabus.empty.title")}
            >
              {t(editable ? "staff.syllabus.empty.write" : "staff.syllabus.empty.read")}
            </Empty>
          ) : (
            <SyllabusMarkdown text={text} lang={locale} />
          )
        ) : (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              send();
            }}
            onKeyDown={keys}
            className="flex flex-col gap-tight"
          >
            <div
              ref={box}
              className="flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-selected"
            >
              <Suspense
                fallback={
                  <span className="flex min-h-40 items-center justify-center text-muted">
                    <Spinner />
                  </span>
                }
              >
                <SyllabusEditor
                  markdown={text}
                  onChange={setDraft}
                  onRead={readBack}
                  labelledBy={headingId}
                  lang={locale}
                />
              </Suspense>
              <div className="flex flex-wrap items-center gap-tight border-hairline border-t bg-tint px-snug py-tight">
                {/* The plain box says what it takes above itself. */}
                <p className="min-w-0 flex-1 text-caption text-muted">
                  {rich && t("staff.syllabus.editor.hint")}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={close} disabled={running}>
                  {t("staff.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  pending={running}
                  shortcut={{
                    keys: `${apple ? "Meta" : "Control"}+Enter`,
                    label: `${apple ? "⌘" : "Ctrl"} ↵`,
                  }}
                >
                  {running ? t("staff.saving") : t("staff.save")}
                </Button>
              </div>
            </div>
            {!clearing && refused}
          </form>
        )}
      </div>
      <AlertDialog
        open={clearing}
        onOpenChange={(open) => {
          if (!open) keep();
        }}
        heading={t("staff.syllabus.clear.title")}
        icon={Eraser}
        description={t("staff.syllabus.clear.body", { section: name })}
        cancelLabel={t("staff.cancel")}
        confirmLabel={t("staff.syllabus.clear.action")}
        onConfirm={clear}
        destructive
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (editButton.current ?? box.current?.querySelector<HTMLElement>(WRITING))?.focus();
        }}
      >
        {clearing && refused}
      </AlertDialog>
    </>
  );
}
