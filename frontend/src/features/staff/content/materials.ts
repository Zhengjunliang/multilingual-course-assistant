/**
 * What an edition's material tab does besides drawing it (MaterialPanel.tsx):
 * the list read again while a row is on its way, and the files chosen sent.
 *
 * The server answers an upload before the ingest begins (apps/materials/views.py),
 * so a row's state changes with no request of the page's: while any row is
 * on its way the list is read again every few seconds, and no longer once
 * every row is ready or failed, or once a read failed.
 *
 * Files are sent one request each, one after another, in the order they were
 * chosen, which is the order the worker takes them in (apps/materials/tasks.py).
 * A file named as a material the edition holds is that material's next
 * version, so it waits for the reader's word while the others go at once;
 * the current version keeps answering until the new one is ready. What was
 * not sent, a file that is not a PDF by its name, one past `MAX_UPLOAD_MIB`
 * or one the server refused, is kept with why until the next files are chosen.
 */

import { useEffect, useRef, useState } from "react";

import { type CourseMaterial, MAX_UPLOAD_MIB, uploadMaterial } from "@/api/catalog";
import type { Sentence } from "@/lib/errorText";
import { type Loaded, useFailure } from "../context";
import { isNotFound } from "../errors";

/** How often a list with a row on its way is read again. */
export const POLL_MS = 2500;

/** A file not sent, and why. */
export interface Unsent {
  /** Two files of one name may be refused, each for its own reason. */
  id: number;
  name: string;
  sentence: Sentence;
  /** The code and the request id of a refusal the reader can only report; null otherwise. */
  reference: Sentence | null;
}

const settled = (material: CourseMaterial) =>
  material.status === "ready" || material.status === "failed";

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

// The server's own sentences for the same refusals: a file it reads as no PDF, a body past its limit.
const NOT_PDF: Sentence = { key: "errors.field.file.INVALID", values: {} };
const TOO_LARGE: Sentence = {
  key: "errors.CONTENT_TOO_LARGE",
  values: { max_mib: MAX_UPLOAD_MIB },
};

/** Why `file` is not sent at all, or null for a file that goes. */
function refusalOf(file: File): Sentence | null {
  if (!isPdf(file)) return NOT_PDF;
  return file.size > MAX_UPLOAD_MIB * 1024 * 1024 ? TOO_LARGE : null;
}

/** Reads `materials` again every `POLL_MS` while one of its rows is on its way. */
export function usePolling({ data: rows, reload }: Loaded<CourseMaterial[]>) {
  useEffect(() => {
    if (rows === null || rows.every(settled)) return;
    const timer = window.setTimeout(() => void reload(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [rows, reload]);
}

export interface Uploads {
  /** The files chosen whose answer has not arrived. */
  sending: number;
  unsent: Unsent[];
  /** The files named as a material the edition holds, waiting for the reader's word. */
  replacing: File[];
  /** Takes the files the reader chose or dropped. */
  take: (files: File[]) => void;
  /** Sends the files waiting, each the next version of its material. */
  replace: () => void;
  /** Forgets the files waiting. */
  keep: () => void;
}

/**
 * Sends files to `edition`, reading `materials` again after each one. An
 * edition gone, or out of the reader's reach, reads the page again, which
 * says so.
 */
export function useUploads(
  edition: number,
  materials: Loaded<CourseMaterial[]>,
  reloadPage: () => Promise<boolean>,
): Uploads {
  const fail = useFailure();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const ids = useRef(0);
  const [sending, setSending] = useState(0);
  const [unsent, setUnsent] = useState<Unsent[]>([]);
  const [replacing, setReplacing] = useState<File[]>([]);

  const unsentFile = (file: File, sentence: Sentence, reference: Sentence | null): Unsent => {
    ids.current += 1;
    return { id: ids.current, name: file.name, sentence, reference };
  };

  const sendOne = async (file: File) => {
    try {
      await uploadMaterial(edition, file);
    } catch (error) {
      if (isNotFound(error)) {
        await reloadPage();
        return;
      }
      // A refused file is a refused `file` field: its sentence says why.
      const text = fail(error, { shownFields: ["file"] });
      const sentence = text.fieldSentences.file?.[0] ?? text.sentence;
      setUnsent((shown) => [...shown, unsentFile(file, sentence, text.reference)]);
      return;
    }
    await materials.reload();
  };

  /** Sends `files` after whatever is being sent, so the worker takes them in order. */
  const send = (files: File[]) => {
    if (files.length === 0) return;
    setSending((count) => count + files.length);
    queue.current = queue.current.then(async () => {
      for (const file of files) {
        await sendOne(file);
        setSending((count) => count - 1);
      }
    });
  };

  return {
    sending,
    unsent,
    replacing,
    take: (files) => {
      if (files.length === 0) return;
      const held = new Set((materials.data ?? []).map((material) => material.source_file));
      const refused = files.map((file) => [file, refusalOf(file)] as const);
      const going = refused.flatMap(([file, why]) => (why === null ? [file] : []));
      setUnsent(
        refused.flatMap(([file, why]) => (why === null ? [] : [unsentFile(file, why, null)])),
      );
      setReplacing(going.filter((file) => held.has(file.name)));
      send(going.filter((file) => !held.has(file.name)));
    },
    replace: () => {
      send(replacing);
      setReplacing([]);
    },
    keep: () => setReplacing([]),
  };
}
