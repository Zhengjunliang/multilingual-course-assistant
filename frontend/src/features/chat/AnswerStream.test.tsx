/**
 * What an answer turns into on screen, read off the markup.
 *
 * Two kinds of claim live here. The Markdown a model writes should read as
 * formatting, with the citation badges surviving the parse wherever they sit.
 * And nothing a model writes may come alive except an absolute http(s) link —
 * a model repeats what a retrieved page told it to, so every case in the
 * "inert" table is an injection that has to stay text.
 */

import { describe, expect, it } from "vitest";

import { PILL_OPEN } from "@/lib/markers";
import { render } from "@/test/render";
import { AnswerStream } from "./AnswerStream";

const SLIDES = "[PPM 3]";
const WEB = "[https://www.unifi.it/p602.html · 2026-09-20]";
const BADGES = [
  { marker: SLIDES, number: 1 },
  { marker: WEB, number: 2 },
];

function answer(text: string, complete = true): string {
  return render(
    <AnswerStream
      text={text}
      badges={BADGES}
      complete={complete}
      live={false}
      onBadgeClick={() => {}}
    />,
  );
}

function count(html: string, fragment: string): number {
  return html.split(fragment).length - 1;
}

const SENTINEL = /[﻿]/;

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
    ["in a sentence", `Le tasse scadono il 30 settembre ${SLIDES}.`, "settembre <button"],
    ["that is a web marker", `Vedi il calendario ${WEB}.`, `title="${WEB}"`],
    [
      "right after a URL",
      `Vedi https://www.unifi.it/p602.html${SLIDES} per le date.`,
      'href="https://www.unifi.it/p602.html"',
    ],
    ["opening a bold run", `**${SLIDES} Le tasse** scadono.`, "<strong><button"],
    [
      "after a bold run that ends in punctuation",
      `**Nota.**${SLIDES} Le tasse scadono.`,
      "<strong>Nota.</strong><button",
    ],
    [
      "at the start of the answer",
      `${SLIDES} Le tasse scadono.`,
      '<p class="whitespace-pre-line"><button',
    ],
  ])("makes one pill of a marker %s, with no link inside it", (_, text, around) => {
    const html = answer(text);

    expect(count(html, "<button")).toBe(1);
    expect(html.match(/<button[^>]*>(.*?)<\/button>/)?.[1]).not.toContain("<a");
    expect(html).toContain(around);
    expect(html).not.toContain("**");
    expect(html).not.toMatch(SENTINEL);
  });

  it("leaves markers as text until the answer is complete", () => {
    const html = answer(`Le tasse scadono il 30 settembre ${SLIDES}.`, false);

    expect(html).toContain(SLIDES);
    expect(html).not.toContain("<button");
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
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(SENTINEL);
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
    ["a stray private-use character", `a ${PILL_OPEN} b &#xE000; c`, "a  b  c", "<button"],
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
