/**
 * A syllabus section written in place (SectionText.tsx): what the box holds,
 * what saving it sends, the keys it answers to, and where the focus goes.
 *
 * Saving an unchanged text closes the box and sends nothing; saving it empty
 * asks first (`clearing`), since the text is kept nowhere else. Once saved the
 * box closes and the focus goes back to «Modifica»; a refusal keeps the box
 * open, with what was written, and the focus in the text. An edition gone
 * from the reader's reach reads the page again.
 *
 * The box is unsaved once what it holds differs from what it opened on, by
 * more than the blank at its ends that saving ignores: a box opened and left
 * as it was is not, and saving it sends nothing. What it opened on is the
 * section's text as the editor writes it back once read (`readBack`), which
 * can differ from the stored text in form alone.
 */

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type SyllabusSection, type SyllabusSectionKey, writeSyllabus } from "@/api/catalog";
import { onApple } from "@/features/chat/shortcuts";
import type { ErrorText } from "@/lib/errorText";
import { useFailure } from "../context";
import { isForbidden, isNotFound } from "../errors";

/** Where the text is written: the editor's, or the plain box where it did not load. */
export const WRITING = '[contenteditable="true"], textarea';

interface SectionDraftOptions {
  edition: number;
  section: SyllabusSectionKey;
  /** The section's name, for what a save says. */
  name: string;
  /** The text the box opens on. */
  text: string;
  onSaved: (row: SyllabusSection, message: string) => void;
  /** Told whenever the box turns unsaved, or saved again. */
  onUnsaved: (section: SyllabusSectionKey, unsaved: boolean) => void;
  reloadPage: () => Promise<boolean>;
}

export function useSectionDraft({
  edition,
  section,
  name,
  text,
  onSaved,
  onUnsaved,
  reloadPage,
}: SectionDraftOptions) {
  const { t } = useTranslation();
  const fail = useFailure();
  const editButton = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** What the box holds, as Markdown; null while the section is read, not edited. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The text as the editor wrote it back once read; null until then, or in the plain box. */
  const [read, setRead] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [refusal, setRefusal] = useState<ErrorText | null>(null);
  const refocus = useRef(false);
  const unsaved = draft !== null && draft.trim() !== (read ?? text).trim();

  /** Takes the text as the editor writes it back once read: what the box holds until a change. */
  const readBack = useCallback((markdown: string) => {
    setRead(markdown);
    setDraft(markdown);
  }, []);

  useEffect(() => onUnsaved(section, unsaved), [onUnsaved, section, unsaved]);

  // Once the box is gone and «Modifica» is back: focus left in a removed box
  // would drop to the page.
  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    editButton.current?.focus();
  }, [draft]);

  const close = () => {
    setDraft(null);
    setRead(null);
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
      const row = (await writeSyllabus(edition, section, value)) ?? { section, text: "" };
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
      if (!clearing) box.current?.querySelector<HTMLElement>(WRITING)?.focus();
      return false;
    } finally {
      setRunning(false);
    }
  };

  const send = () => {
    if (draft === null || running) return;
    if (!unsaved) close();
    else if (draft.trim() === "") setClearing(true);
    else void write(draft);
  };

  /** Ctrl Enter saves, Escape in the text cancels; neither while a word is composed. */
  const keys = (event: KeyboardEvent<HTMLFormElement>) => {
    // A key in the link's dialog reaches here through React's tree, though the
    // dialog is elsewhere on the page: it is the dialog's.
    if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
    // Safari ends a composition before the key that ends it, and marks the key 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229 || running) return;
    if (event.key === "Escape" && event.target.matches(WRITING)) close();
    if (event.key === "Enter" && (onApple() ? event.metaKey : event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };

  return {
    editButton,
    box,
    draft,
    /** Opens the box on the section's text, or hands it what was written. */
    setDraft,
    /** Whether the box is the editor, which alone writes the text back once read. */
    rich: read !== null,
    readBack,
    running,
    clearing,
    forbidden,
    refusal,
    close,
    send,
    keys,
    /** Empties the section, once the question is answered. */
    clear: () => write(""),
    /** Leaves the section as it is, the question dismissed. */
    keep: () => {
      setClearing(false);
      setForbidden(false);
      setRefusal(null);
    },
  };
}
