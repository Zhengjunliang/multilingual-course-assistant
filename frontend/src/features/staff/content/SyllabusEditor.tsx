/**
 * A syllabus section written as a document, not as Markdown: what the
 * section's «Modifica» opens (SectionText.tsx), loaded only then, since
 * Tiptap and ProseMirror are no part of a page that is only read.
 *
 * A toolbar over the text, as GitHub's comment box and Google Docs have one:
 * bold, italics, the two lists and a link, each a button whose state is
 * `aria-pressed` and whose hint names its key (Ctrl B, Ctrl I, Ctrl K). The
 * toolbar is one tab stop with the arrows between its buttons, the WAI-ARIA
 * toolbar pattern (outside the repository: WAI-ARIA APG, "Toolbar Pattern"),
 * and a press on a button leaves the focus in the text. Ctrl K is the
 * editor's while the focus is in it, as in every editor: it asks for a link
 * (LinkDialog.tsx) rather than opening the search.
 *
 * What the editor writes is editorKit.ts's: the text is read from Markdown and
 * each change is handed back as Markdown. Saving and cancelling are the
 * section's (Ctrl Enter, Escape): Ctrl Enter adds no line break here, where
 * StarterKit's would. A text the editor would not keep whole is written as
 * the Markdown it is (MarkdownArea.tsx). Once read, the editor hands back the
 * text as it writes it, a `-` where the text had `*`: that, not the stored
 * text, is what a box left unchanged holds.
 */

import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Italic, Link2, List, ListOrdered, type LucideIcon } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { Shortcut } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { onApple } from "@/features/chat/shortcuts";
import { markdownOf, syllabusKit, written } from "./editorKit";
import { LinkDialog } from "./LinkDialog";
import { MarkdownArea } from "./MarkdownArea";

export interface EditorProps {
  /** The text it opens on, in Markdown. */
  markdown: string;
  /** Each change, as the Markdown it would save. */
  onChange: (markdown: string) => void;
  /** The text as the editor writes it back once read, where it rewrites the Markdown it reads. */
  onRead?: (markdown: string) => void;
  /** The id of the heading that names the text. */
  labelledBy: string;
  /** The language the text is written in. */
  lang: string;
}

type Tool = "bold" | "italic" | "bulletList" | "orderedList" | "link";

/** The toolbar's buttons in its order, a group per row of the design; each one's key, if any. */
const GROUPS: { tool: Tool; icon: LucideIcon; key?: string }[][] = [
  [
    { tool: "bold", icon: Bold, key: "B" },
    { tool: "italic", icon: Italic, key: "I" },
  ],
  [
    { tool: "bulletList", icon: List },
    { tool: "orderedList", icon: ListOrdered },
  ],
  [{ tool: "link", icon: Link2, key: "K" }],
];
const TOOLS = GROUPS.flat();

/** The text's own styles: the rendered section's (SyllabusMarkdown.tsx), on ProseMirror's elements. */
const TEXT =
  "min-h-40 px-gutter py-snug text-ink text-reading outline-none [&>*+*]:mt-snug [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-room [&_ol]:pl-room [&_li]:marker:text-muted [&_li+li]:mt-hair [&_a]:underline [&_a]:decoration-muted [&_a]:underline-offset-2";

export default function SyllabusEditor(props: EditorProps) {
  // Read once, before an editor that would empty the text could take it.
  const [read] = useState(() => written(props.markdown));
  const { onRead } = props;
  // Once mounted, before the reader can type: Tiptap's own `create` comes a
  // task later, after a test or a fast hand may have written.
  useEffect(() => {
    if (read !== null) onRead?.(read);
  }, [read, onRead]);
  return read !== null ? <RichEditor {...props} /> : <MarkdownArea {...props} />;
}

function RichEditor({ markdown, onChange, labelledBy, lang }: EditorProps) {
  const { t } = useTranslation();
  const apple = onApple();
  /** The link the dialog edits, empty for a new one; null while it is closed. */
  const [linking, setLinking] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const askLink = (editor: Editor) => setLinking(editor.getAttributes("link").href ?? "");

  const editor = useEditor({
    extensions: syllabusKit(),
    content: markdown,
    contentType: "markdown",
    // The reader pressed «Modifica» to write here.
    autofocus: "end",
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelledBy,
        lang,
        class: TEXT,
      },
      handleKeyDown: (_view, event) => {
        if (!(apple ? event.metaKey : event.ctrlKey) || event.altKey) return false;
        // The section saves on it (SectionText.tsx); StarterKit would break the line.
        if (event.key === "Enter") return true;
        if (event.key.toLowerCase() === "k" && !event.shiftKey) {
          // Not the shell's search: the window never hears it.
          event.stopPropagation();
          if (editor !== null) askLink(editor);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: changed }) => onChange(markdownOf(changed)),
  });

  const pressed = useEditorState({
    editor,
    selector: ({ editor: shown }) =>
      Object.fromEntries(TOOLS.map(({ tool }) => [tool, shown?.isActive(tool) ?? false])) as Record<
        Tool,
        boolean
      >,
  });

  if (editor === null) return null;

  const run = (tool: Tool) => {
    const chain = editor.chain().focus();
    if (tool === "bold") chain.toggleBold().run();
    else if (tool === "italic") chain.toggleItalic().run();
    else if (tool === "bulletList") chain.toggleBulletList().run();
    else if (tool === "orderedList") chain.toggleOrderedList().run();
    else askLink(editor);
  };

  const apply = (href: string) => {
    setLinking(null);
    if (editor.state.selection.empty && !editor.isActive("link")) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  // The arrows move between the buttons, Home and End to the first and the last.
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = TOOLS.length - 1;
    const to =
      event.key === "ArrowRight"
        ? (current + 1) % TOOLS.length
        : event.key === "ArrowLeft"
          ? (current + last) % TOOLS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    setCurrent(to);
    buttons.current[to]?.focus();
  };

  const shortcut = (key: string | undefined): Shortcut | undefined =>
    key === undefined
      ? undefined
      : { keys: `${apple ? "Meta" : "Control"}+${key}`, label: `${apple ? "⌘" : "Ctrl"} ${key}` };

  return (
    <>
      <div
        role="toolbar"
        aria-label={t("staff.syllabus.editor.toolbar")}
        onKeyDown={move}
        className="flex flex-wrap items-center gap-hair border-hairline border-b bg-tint p-hair"
      >
        {GROUPS.map((group, at) => (
          <Fragment key={group[0]?.tool}>
            {at > 0 && <span aria-hidden className="mx-hair h-icon-lg w-px bg-line" />}
            {group.map(({ tool, icon: Icon, key }) => {
              const index = TOOLS.findIndex((each) => each.tool === tool);
              const label = t(`staff.syllabus.editor.${tool}`);
              return (
                <Tooltip key={tool} content={label} shortcut={shortcut(key)}>
                  <Button
                    ref={(element) => {
                      buttons.current[index] = element;
                    }}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    aria-pressed={pressed[tool]}
                    tabIndex={index === current ? 0 : -1}
                    // The focus stays in the text, and with it the selection.
                    onMouseDown={(event) => event.preventDefault()}
                    onFocus={() => setCurrent(index)}
                    onClick={() => run(tool)}
                    className="aria-pressed:bg-selected aria-pressed:text-accent"
                  >
                    <Icon aria-hidden className="size-icon" />
                  </Button>
                </Tooltip>
              );
            })}
          </Fragment>
        ))}
      </div>
      <EditorContent editor={editor} />
      <LinkDialog
        href={linking}
        onApply={apply}
        onRemove={() => {
          setLinking(null);
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
        }}
        onClose={() => setLinking(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      />
    </>
  );
}
