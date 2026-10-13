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
 *
 * A section can still hold what the editor cannot write, through the plain
 * box, the API or the admin: a heading, a table, code, raw HTML. The parser
 * drops such a block, or, for a node the schema lacks, empties the whole
 * document, and the next save would store what is left. `written` looks at a
 * text before the editor is offered: one with a block or a mark the editor
 * does not write, or that loses a word read in and written back, is written
 * as the Markdown it is instead.
 */

import { Markdown } from "@tiptap/markdown";
import { Editor, type Extensions } from "@tiptap/react";
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

/** What the editor writes, by the names marked gives its tokens. */
const WRITES = new Set([
  "space",
  "paragraph",
  "text",
  "escape",
  "strong",
  "em",
  "link",
  "br",
  "list",
  "list_item",
]);

interface Token {
  type: string;
  tokens?: Token[];
  items?: Token[];
}

function writable(tokens: readonly Token[]): boolean {
  return tokens.every(
    (token) =>
      WRITES.has(token.type) && writable(token.tokens ?? []) && writable(token.items ?? []),
  );
}

/** A text's words, its runs of letters and digits in order, whatever marks them up. */
function words(text: string): string {
  return text.match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
}

/** `markdown` read into `editor` and written back, or null when that loses a word. */
function readBack(editor: Editor, markdown: string): string | null {
  editor.commands.setContent(markdown, { contentType: "markdown" });
  const back = markdownOf(editor);
  return words(back) === words(markdown) ? back : null;
}

/**
 * `markdown` as the editor writes it back once read, or null when the editor
 * would not keep it whole: a block or a mark in it that the editor does not
 * write, read by the parser the editor reads with, or a word lost on the way
 * in and back. The text goes into an empty editor only once its blocks pass,
 * since one the schema lacks has Tiptap warn of it.
 */
export function written(markdown: string): string | null {
  const editor = new Editor({ extensions: syllabusKit() });
  const tokens: readonly Token[] | undefined = editor.markdown?.instance.lexer(markdown);
  const back = tokens !== undefined && writable(tokens) ? readBack(editor, markdown) : null;
  editor.destroy();
  return back;
}
