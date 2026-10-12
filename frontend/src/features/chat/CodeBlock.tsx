/**
 * A code block of an answer, under a head that names its language and copies
 * it (#193), as ChatGPT, claude.ai and Gemini draw one.
 *
 * The language is the one the model wrote after the opening fence
 * (```sql), which react-markdown passes on as `language-sql`; a fence that
 * names none leaves the head with its button alone. What is copied is the
 * code as shown, read off the element, so it is exactly what the reader sees.
 * The code itself stays in ink and unhighlighted (AnswerMarkdown.tsx says why).
 */

import { Check, Copy } from "lucide-react";
import { Children, type ComponentProps, isValidElement, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useCopy } from "./useCopy";

/** The language a fence named, from its code element's `language-…` class. */
function languageOf(children: ComponentProps<"pre">["children"]): string | undefined {
  const [code] = Children.toArray(children);
  if (!isValidElement<{ className?: string }>(code)) return undefined;
  return /\blanguage-([^\s]+)/.exec(code.props.className ?? "")?.[1];
}

export function CodeBlock({ children }: ComponentProps<"pre">) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  const block = useRef<HTMLPreElement>(null);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-control border border-line bg-tint">
      <div className="flex items-center gap-tight border-line border-b py-hair pr-hair pl-snug">
        <span className="flex-1 font-mono text-caption text-muted">{languageOf(children)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Without the newline Markdown ends every block with, which pasting
          // would carry as an empty line.
          onClick={() => copy((block.current?.textContent ?? "").replace(/\n$/, ""))}
        >
          {copied ? (
            <Check aria-hidden className="size-icon" />
          ) : (
            <Copy aria-hidden className="size-icon" />
          )}
          {copied ? t("code.copied") : t("code.copy")}
        </Button>
        <span role="status" className="sr-only">
          {copied ? t("code.copied") : ""}
        </span>
      </div>
      <pre
        ref={block}
        className="overflow-x-auto p-snug font-mono text-caption [&>code]:bg-transparent [&>code]:p-0"
      >
        {children}
      </pre>
    </div>
  );
}
