/**
 * What the syllabus editor can write (SyllabusEditor.tsx), and the Markdown
 * it reads and writes: Tiptap's StarterKit cut down to paragraphs, bold,
 * italics, the two lists, a link and a line break, with undo, as GitLab's
 * rich text editor builds on Tiptap and stores Markdown (outside the
 * repository: GitLab, "Rich text editor"). Headings, code, quotes, rules,
 * strikethrough and underline are off: a syllabus section is one heading's
 * worth of prose, and what the editor cannot write it never has to keep.
 *
 * `@tiptap/markdown` parses the stored text into the editor and serialises
 * it back. A section opened and saved unchanged must come back byte for byte,
 * so the seed is written in the form this serialiser writes (a line break as
 * two spaces before the newline, a bare URL as a link to itself), and a test
 * opens and saves every seeded section. The serialiser ends a list with blank
 * lines; `markdownOf` drops the white space at the end, as the server does.
 *
 * A link is live only when it is an absolute http(s) URL, the same rule the
 * rendered text follows (`safeUrl`): a pasted `javascript:` link stays text,
 * and one the stored text holds is drawn with no address.
 */

import { Markdown } from "@tiptap/markdown";
import type { Editor, Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { safeUrl } from "@/features/chat/AnswerMarkdown";

export function syllabusKit(): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      code: false,
      strike: false,
      underline: false,
      link: {
        openOnClick: false,
        defaultProtocol: "https",
        isAllowedUri: (url) => safeUrl(url) !== undefined,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      },
    }),
    Markdown,
  ];
}

/** The editor's text as Markdown, as it is stored. */
export function markdownOf(editor: Editor): string {
  return editor.getMarkdown().replace(/\s+$/, "");
}
