/**
 * What an answer turns into on screen, read off the markup.
 *
 * Two kinds of claim live here. The Markdown a model writes should read as
 * formatting, with the citation pills surviving the parse wherever they sit.
 * And nothing a model writes may come alive except an absolute http(s) link —
 * a model repeats what a retrieved page told it to, so every case in the
 * "inert" table is an injection that has to stay text.
 */

import { describe, expect, it } from "vitest";

import type { Citation } from "@/api/contract";
import { PILL_BREAK, PILL_CLOSE, PILL_OPEN } from "@/lib/markers";
import { render } from "@/test/render";
import { AnswerStream } from "./AnswerStream";

const SLIDES = "[PPM 3]";
const WEB = "[https://www.unifi.it/p602.html · 2026-09-20]";
const BADGES = [
  { marker: SLIDES, number: 1 },
  { marker: WEB, number: 2 },
];

const SLIDE: Citation = {
  marker: SLIDES,
  kind: "slides",
  text: "Lossless compression keeps every bit.",
  heading_path: ["Compressione"],
  course: "B028451",
  academic_year: "2025-2026",
  locale: "en",
  score: 0.5,
  source_file: "PPM-05-compressione.pdf",
  source_sha256: "ab".repeat(32),
  page: 3,
  url: null,
  fetch_date: null,
};

const CITATIONS: Citation[] = [
  SLIDE,
  {
    ...SLIDE,
    marker: WEB,
    kind: "web",
    text: "Il calendario delle lezioni.",
    heading_path: ["Calendario"],
    locale: "it",
    source_file: "",
    source_sha256: null,
    page: 1,
    url: "https://www.unifi.it/p602.html",
    fetch_date: "2026-09-20",
  },
];

/** A pill's whole element: the link `CitationPill` draws, marked `data-pill`. */
const PILL = /<a[^>]*data-pill[^>]*>(.*?)<\/a>/;

function answer(text: string, complete = true): string {
  return render(
    <AnswerStream
      text={text}
      badges={BADGES}
      complete={complete}
      live={false}
      citations={CITATIONS}
    />,
  );
}

function count(html: string, fragment: string): number {
  return html.split(fragment).length - 1;
}

const SENTINEL = new RegExp(`[${PILL_OPEN}${PILL_CLOSE}${PILL_BREAK}]`);

describe("an answer", () => {
  it("renders the Markdown a model writes: lists, bold, tables, code and quotes", () => {
    const html = answer(
      [
        "Le **scadenze** sono:",
        "",
        "- prima rata",
        "- seconda rata",
        "",
        "| Rata | Data |",
        "| --- | --- |",
        "| 1 | 30/09 |",
        "",
        "```python",
        "class Esame(models.Model): ...",
        "```",
        "",
        "> Fonte: il regolamento.",
      ].join("\n"),
    );

    expect(html).toContain("<strong>scadenze</strong>");
    expect(html).toContain("<ul");
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
    expect(html).toContain("<blockquote");
  });

  it.each([
    ["in a sentence", `Le tasse scadono il 30 settembre ${SLIDES}.`, "settembre <a"],
    ["that is a web marker", `Vedi il calendario ${WEB}.`, 'aria-label="Fonte: unifi.it"'],
    [
      "right after a URL",
      `Vedi https://www.unifi.it/p602.html${SLIDES} per le date.`,
      'href="https://www.unifi.it/p602.html"',
    ],
    ["opening a bold run", `**${SLIDES} Le tasse** scadono.`, "<strong><a"],
    [
      "after a bold run that ends in punctuation",
      `**Nota.**${SLIDES} Le tasse scadono.`,
      "<strong>Nota.</strong><a",
    ],
    [
      "at the start of the answer",
      `${SLIDES} Le tasse scadono.`,
      '<p class="whitespace-pre-line"><a',
    ],
    // Two links micromark leaves alone and GFM's later pass finds, running to
    // the next ASCII space: after full-width punctuation, and inside a `[`.
    ["after a link found late", `详情见官网（www.unifi.it）${WEB}的说明。`, "</a><a"],
    ["inside an open bracket", `[vedi https://x.it/a${SLIDES}]`, "</a><a"],
  ])("makes one pill of a marker %s, with no link inside it", (_, text, around) => {
    const html = answer(text);

    expect(count(html, "data-pill")).toBe(1);
    expect(html.match(PILL)?.[1]).not.toContain("<a");
    expect(html).toContain(around);
    expect(html).not.toContain("**");
    expect(html).not.toMatch(SENTINEL);
  });

  it("leaves markers as text until the answer is complete", () => {
    const html = answer(`Le tasse scadono il 30 settembre ${SLIDES}.`, false);
    // Sentinel characters a model wrote itself are not a pill either.
    const spelled = answer(`Vedi ${PILL_OPEN}1${PILL_CLOSE}.`, false);

    expect(html).toContain(SLIDES);
    expect(html).not.toContain("data-pill");
    expect(spelled).not.toContain("data-pill");
  });

  it("draws the caret after the last word only while words arrive", () => {
    const streaming = (text: string, live: boolean) =>
      render(
        <AnswerStream
          text={text}
          badges={BADGES}
          complete={false}
          live={live}
          citations={CITATIONS}
        />,
      );

    // The caret is the prose's own `::after` (index.css, `caret-after`), so
    // it follows the last word wherever the last block ends.
    expect(count(streaming("Le tasse scadono", true), "caret-after")).toBe(1);
    expect(count(streaming("", true), "caret-after")).toBe(1);
    // Stopped halfway, the answer is what it is: nothing is still coming.
    expect(count(streaming("Le tasse scadono", false), "caret-after")).toBe(0);
    expect(count(answer("Le tasse scadono il 30 settembre."), "caret-after")).toBe(0);
  });

  it("keeps the space between two inline elements of a list item", () => {
    expect(answer("- **Prima rata** *30/09*")).toContain(
      "<strong>Prima rata</strong> <em>30/09</em>",
    );
  });

  it("hides the label GFM gives a footnote section", () => {
    // It is English whatever the interface language; screen readers keep it.
    expect(answer("Scade il 30[^1].\n\n[^1]: Regolamento.")).toMatch(
      /class="[^"]*sr-only[^"]*"[^>]*>Footnotes/,
    );
  });

  it("links to the URL it checked, not to a spelling the browser reads as relative", () => {
    // `https:evil.example` parses to https://evil.example/ without a base, and
    // to a path of this site with one: the href must be the first.
    expect(answer("[login](https:evil.example)")).toContain('href="https://evil.example/"');
  });

  it("shows an answer nested too deep to draw as its plain text, markers included", () => {
    // Thousands of nested quotes exhaust the parser's recursion. Thrown, that
    // would blank the stored conversation every time it is reopened.
    expect(answer(`${">".repeat(3000)} x ${SLIDES}`)).toContain(`x ${SLIDES}`);
  });

  it.each([
    ["inside inline code", `Scrivi \`${SLIDES}\` così.`, `${SLIDES}</code>`],
    ["inside a link's text", `[vedi ${SLIDES}](https://www.unifi.it)`, `vedi ${SLIDES}`],
    [
      "inside an image's alt",
      `![figura ${SLIDES}](https://www.unifi.it/f.png)`,
      `figura ${SLIDES}`,
    ],
  ])("keeps a marker %s as its own text", (_, text, shown) => {
    const html = answer(text);

    expect(html).toContain(shown);
    expect(html).not.toContain("data-pill");
    expect(html).not.toMatch(SENTINEL);
  });

  it("keeps LaTeX intact, and typesets it once KaTeX is loaded", async () => {
    // A set from the slides: Markdown alone would read `\{` as an escaped
    // brace and drop the backslash.
    const formula = String.raw`\{1, \sqrt{2}\}`;
    const text = `L'insieme è $$${formula}$$.`;

    // The first render has only the fallback: KaTeX is a chunk of its own.
    const before = answer(text);
    expect(before).toContain("language-math");
    expect(before).toContain(formula);
    expect(before).not.toContain('class="katex"');

    await import("./MathMarkdown");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = answer(text);
    expect(after).toContain('class="katex"');
    expect(after).toContain(`<annotation encoding="application/x-tex">${formula}</annotation>`);
  });

  it("caps the size of what a formula may draw", async () => {
    // A formula repeated from a hostile page could paint a block over the
    // sources above it; KaTeX leaves sizes unbounded unless told otherwise.
    await import("./MathMarkdown");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const html = answer(String.raw`Vedi $$\rule{60em}{30em}$$.`);
    expect(html).toContain('class="katex"');
    // The source stays in the annotation; the drawn rule is what is capped.
    expect(html).not.toContain("width:60em");
  });

  it("keeps KaTeX untrusted when Object.prototype carries a trust", async () => {
    // GHSA-238p-pmpm-9mq7: KaTeX before 0.18.2 reads an inherited `trust` as
    // if the page had set it, and then `\href` is a link and `\htmlStyle` a
    // style that may fetch from any host. An option of KaTeX's own shadows it.
    // A first render starts the lazy load, which a bare import does not.
    answer("$$x$$");
    await import("./MathMarkdown");
    await new Promise((resolve) => setTimeout(resolve, 0));

    Object.defineProperty(Object.prototype, "trust", {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      const html = answer(
        String.raw`Vedi $$\href{https://attacker.example}{x}\htmlStyle{color:red}{y}$$.`,
      );
      expect(html).toContain('class="katex"');
      expect(html).not.toContain('href="https://attacker.example');
      expect(html).not.toContain('style="color:red');
    } finally {
      Reflect.deleteProperty(Object.prototype, "trust");
    }
  });

  it("bolds Chinese text that ends in full-width punctuation", () => {
    expect(answer("**注意：**请按时缴费。")).toContain("<strong>注意：</strong>请按时缴费。");
  });

  it.each([
    ["raw HTML", "<img src=x onerror=alert(1)>", "&lt;img", "<img"],
    ["a javascript: link", "[clicca](javascript:alert(1))", "clicca", "<a"],
    ["a relative link", "[calendario](p602.html)", "calendario", "<a"],
    ["an image", "![grafico](https://attacker.example/p.png?q=1)", "grafico", "attacker.example"],
    ["a link with no host", "[x](https://)", ">x<", "<a"],
    ["a stray private-use character", `a ${PILL_OPEN} b &#xE000; c`, "a  b  c", "data-pill"],
    [
      "a pill spelled with character references",
      "see &#xE000;1&#xE001; now",
      "see 1 now",
      "data-pill",
    ],
  ])("keeps %s inert", (_, text, shown, absent) => {
    const html = answer(text);

    expect(html).toContain(shown);
    expect(html).not.toContain(absent);
    expect(html).not.toMatch(SENTINEL);
  });

  it.each([
    ["a link whose text is a name", "[UniFi](https://www.unifi.it)", true],
    ["a bare URL", "https://www.unifi.it/p602.html", false],
    ["a www. link", "www.unifi.it/p602.html", false],
    [
      "a link whose text is its target",
      "[https://www.unifi.it/città](https://www.unifi.it/citt%C3%A0)",
      false,
    ],
  ])("opens %s in a new tab, naming its host only when the text hides it", (_, text, named) => {
    const html = answer(text);

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html.includes(" (www.unifi.it)")).toBe(named);
  });
});
