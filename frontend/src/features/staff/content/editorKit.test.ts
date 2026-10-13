// @vitest-environment jsdom

/**
 * A syllabus section opened in the editor and saved unchanged comes back byte
 * for byte, for every section the demo seed writes
 * (apps/roles/management/commands/demo_content.json): the seed is read as the
 * test data it is, and a serialiser that rewrote any of it would have every
 * teacher's first save change text they never touched.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";

import { markdownOf, syllabusKit } from "./editorKit";

interface Seed {
  editions: { edition: string; syllabus: { sections: Record<string, string> } }[];
}

// From the working directory, vitest's root: under jsdom `import.meta.url` is
// an http URL (src/test/componentLayer.ts).
const SEED = join(
  process.cwd(),
  "..",
  "apps",
  "roles",
  "management",
  "commands",
  "demo_content.json",
);
const seed = JSON.parse(readFileSync(SEED, "utf-8")) as Seed;
const sections = seed.editions.flatMap(({ edition, syllabus }) =>
  Object.entries(syllabus.sections).map(([section, text]) => [`${edition} ${section}`, text]),
);

/** The text as the editor writes it back after reading it. */
function reread(text: string): string {
  const editor = new Editor({ extensions: syllabusKit(), content: text, contentType: "markdown" });
  const written = markdownOf(editor);
  editor.destroy();
  return written;
}

describe("the syllabus editor", () => {
  it("reads every seeded section", () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  it.each(sections)("writes %s back as it read it", (_, text) => {
    expect(reread(text)).toBe(text);
  });

  it("leaves a link live in the editor only when it is an absolute http(s) URL", () => {
    const hrefs = ["[Sito](https://www.unifi.it/)", "[Sito](javascript:alert(1))"].map((text) => {
      const editor = new Editor({
        extensions: syllabusKit(),
        content: text,
        contentType: "markdown",
      });
      const href = editor.view.dom.querySelector("a")?.getAttribute("href");
      editor.destroy();
      return href;
    });

    expect(hrefs).toEqual(["https://www.unifi.it/", ""]);
  });
});
