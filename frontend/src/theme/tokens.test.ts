/**
 * Every screen spends corners, shadows, layers and motion through the names in
 * index.css, and sets its headings in the serif.
 *
 * The whole of src, not the component layer alone: the layer was clean first,
 * and a page that writes `rounded-lg` beside a card that says `rounded-card`
 * is the same drift one directory up. Read from the files rather than a list
 * written by hand, so a new page is checked without anyone remembering to add
 * it. Test files are left out: their class names are fixtures.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…".
const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(extension: RegExp): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : walk(path);
      return extension.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
    });
  return walk(SRC);
}

/** Every match of `pattern` in the files, as "file:line match". */
function found(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        [...line.matchAll(pattern)].map(
          ([match]) => `${relative(SRC, file)}:${index + 1} ${match}`,
        ),
      ),
  );
}

const COMPONENTS = sources(/\.tsx$/);

describe("the screens", () => {
  it("knows which files it reads", () => {
    // An empty listing would make every check below pass by finding nothing.
    expect(COMPONENTS.length).toBeGreaterThan(20);
  });

  it("spend corners and shadows through named tokens only", () => {
    // `rounded-md` says how round, `rounded-control` says what wears it, and
    // only the second keeps a button and a field agreeing once one is edited.
    // `rounded-full` is a shape, not a step, and stays. The lookarounds keep a
    // named token (`rounded-card`, `shadow-raised`) and a longer word
    // (`shadowing`) from matching. Components only: in a `.ts` file the words
    // are prose.
    const RAW_SHAPE =
      /(?<![\w-])(?:rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?(?:-(?:xs|sm|md|lg|xl|[2-4]xl))?|shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl))?)(?![\w-])/g;

    expect(found(COMPONENTS, RAW_SHAPE)).toEqual([]);
  });

  it("name their layers and their motion", () => {
    // #128's check, as written there: a numbered layer, duration or delay, or a
    // time in an arbitrary value, outside index.css.
    const RAW_MOTION = /z-\[?[0-9]|duration-[0-9]|delay-[0-9]|[0-9.]+m?s\]/g;

    expect(found(sources(/\.tsx?$/), RAW_MOTION)).toEqual([]);
  });

  it("set every title and display heading in the serif", () => {
    // Fraunces for the headings and the answer, Figtree for the controls: a
    // class list at title or display size without `font-serif` is a heading
    // left in the controls' face.
    const sansHeadings = found(COMPONENTS, /"[^"]*\btext-(?:title|display)\b[^"]*"/g).filter(
      (hit) => !/\bfont-serif\b/.test(hit),
    );

    expect(sansHeadings).toEqual([]);
  });
});
