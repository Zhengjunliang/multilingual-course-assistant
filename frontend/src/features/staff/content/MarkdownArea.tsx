/**
 * A section's text as the Markdown it is, in a plain box, under a line that
 * says so: where the editor's chunk did not load (SectionText.tsx), as an
 * answer whose typesetting did not load is shown without it
 * (features/chat/AnswerStream.tsx), and where the text holds what the editor
 * cannot write, which it would drop on the next save (editorKit.ts, `holds`).
 */

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { EditorProps } from "./SyllabusEditor";

export function MarkdownArea({ markdown, onChange, labelledBy, lang }: EditorProps) {
  const { t } = useTranslation();
  const area = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  // The reader pressed «Modifica» to write here.
  useEffect(() => area.current?.focus(), []);
  return (
    <>
      <p
        id={noteId}
        className="border-hairline border-b bg-tint px-gutter py-tight text-caption text-muted"
      >
        {t("staff.syllabus.editor.markdown")}
      </p>
      <textarea
        ref={area}
        aria-labelledby={labelledBy}
        aria-describedby={noteId}
        lang={lang}
        defaultValue={markdown}
        onChange={(event) => onChange(event.target.value)}
        className="field-sizing-content max-h-[60vh] min-h-40 resize-y bg-transparent px-gutter py-snug text-ink text-reading outline-none"
      />
    </>
  );
}
