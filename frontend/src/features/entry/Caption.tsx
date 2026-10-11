/**
 * The entry's caption, which the intro writes in (E22 of #135, after Oryzo
 * AI): each grapheme blurs in after the one before, so a line arrives the way
 * handwriting would. `Intl.Segmenter` cuts the line: by grapheme for Latin and
 * Chinese, by word for Arabic, whose letters join and would come apart one by
 * one. Graphemes are held together inside each word, so a line wraps between
 * words and never inside one.
 *
 * The heading's name is always the settled caption, `aria-label` on the
 * heading with the moving letters hidden from assistive technology, so a
 * screen reader hears one sentence once instead of six languages in turn.
 * For a reader who never got the intro it is plain text.
 */

import { type CSSProperties, useMemo } from "react";

import { cn } from "@/lib/utils";

interface CaptionProps {
  /** The sentence the heading settles on, in the interface's language. */
  caption: string;
  /** What to write in, or `null` for the caption at rest. */
  writing: { lang: string; text: string } | null;
  className?: string;
}

function graphemesByWord(lang: string, text: string): string[][] {
  const words = new Intl.Segmenter(lang, { granularity: "word" });
  const graphemes = new Intl.Segmenter(lang, { granularity: "grapheme" });
  return [...words.segment(text)].map(({ segment }) =>
    lang === "ar" ? [segment] : [...graphemes.segment(segment)].map((g) => g.segment),
  );
}

export function Caption({ caption, writing, className }: CaptionProps) {
  const words = useMemo(
    () => (writing === null ? null : graphemesByWord(writing.lang, writing.text)),
    [writing],
  );
  const heading = cn("text-balance", className);

  if (writing === null || words === null) return <h2 className={heading}>{caption}</h2>;

  let index = 0;
  return (
    <h2 className={heading} aria-label={caption}>
      {/* Keyed by the line, so a new line starts its letters over. The serif
          is named again here: an element with `lang` takes its language's
          stack back (index.css), which is the sans unless it says otherwise,
          and `font-serif` is what turns to the Chinese stack in Chinese. */}
      <span
        key={`${writing.lang} ${writing.text}`}
        aria-hidden
        lang={writing.lang}
        dir={writing.lang === "ar" ? "rtl" : "ltr"}
        className="font-serif"
      >
        {words.map((graphemes, w) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's words never reorder
          <span key={w} className="whitespace-pre">
            {graphemes.map((grapheme, g) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: nor do a word's letters
                key={g}
                className="blur-in inline-block"
                style={{ "--i": index++ } as CSSProperties}
              >
                {grapheme}
              </span>
            ))}
          </span>
        ))}
      </span>
    </h2>
  );
}
