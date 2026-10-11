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
 *
 * While it writes, the heading is as tall as the tallest line it will ever
 * hold: every line the intro writes and the caption lie unseen in the cell the
 * writing takes, cut the same way, so they wrap where the writing would. A
 * line that wraps on a narrow screen, as the Italian caption does at 375 px,
 * then moves nothing under the heading, neither when it arrives nor after.
 */

import { type CSSProperties, useMemo } from "react";

import { cn } from "@/lib/utils";

interface Written {
  lang: string;
  text: string;
}

interface CaptionProps {
  /** The sentence the heading settles on, in the interface's language. */
  caption: string;
  /** What to write in, or `null` for the caption at rest. */
  writing: Written | null;
  /** Every line the heading will hold while it writes, the caption included. */
  holds?: readonly Written[];
  className?: string;
}

function graphemesByWord(lang: string, text: string): string[][] {
  const words = new Intl.Segmenter(lang, { granularity: "word" });
  const graphemes = new Intl.Segmenter(lang, { granularity: "grapheme" });
  return [...words.segment(text)].map(({ segment }) =>
    lang === "ar" ? [segment] : [...graphemes.segment(segment)].map((g) => g.segment),
  );
}

interface LineProps extends Written {
  arrives: boolean;
  className?: string;
}

/**
 * One line cut into its words and graphemes; `arrives` blurs each grapheme in
 * after the one before. The serif is named again here: an element with `lang`
 * takes its language's stack back (index.css), which is the sans unless it
 * says otherwise, and `font-serif` is what turns to the Chinese stack in
 * Chinese.
 */
function Line({ lang, text, arrives, className }: LineProps) {
  const words = useMemo(() => graphemesByWord(lang, text), [lang, text]);
  let index = 0;
  return (
    <span
      aria-hidden
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={cn("col-start-1 row-start-1 font-serif", className)}
    >
      {words.map((graphemes, w) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's words never reorder
        <span key={w} className="whitespace-pre">
          {graphemes.map((grapheme, g) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: nor do a word's letters
              key={g}
              className={cn("inline-block", arrives && "blur-in")}
              style={arrives ? ({ "--i": index++ } as CSSProperties) : undefined}
            >
              {grapheme}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function Caption({ caption, writing, holds = [], className }: CaptionProps) {
  const heading = cn("text-balance", className);

  if (writing === null) return <h2 className={heading}>{caption}</h2>;

  return (
    <h2 className={cn("grid", heading)} aria-label={caption}>
      {holds.map((line) => (
        <Line
          key={`held ${line.lang} ${line.text}`}
          {...line}
          arrives={false}
          className="invisible"
        />
      ))}
      {/* Keyed by the line, so a new line starts its letters over. */}
      <Line key={`writing ${writing.lang} ${writing.text}`} {...writing} arrives />
    </h2>
  );
}
