/**
 * What index.css promises that no mounted test can see. jsdom applies no
 * stylesheet, and vitest hands a stylesheet import back empty, so these read
 * the file itself. What a browser then computes from it is e2e/type.spec.ts.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");
/** The rules alone: a comment may quote one. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

type Span = readonly [number, number];

/** Each self-hosted family, and the code points its faces cover. */
function faces(css: string): Map<string, Span[]> {
  const found = new Map<string, Span[]>();
  for (const [, body = ""] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = body.match(/font-family:\s*"([^"]+)"/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (family === undefined || range === undefined) continue;
    const spans = range.split(",").map((part): Span => {
      const [from = "", to] = part.trim().replace(/^U\+/i, "").split("-");
      const start = Number.parseInt(from, 16);
      return [start, to === undefined ? start : Number.parseInt(to, 16)];
    });
    found.set(family, [...(found.get(family) ?? []), ...spans]);
  }
  return found;
}

/** The families of the theme's stack `--name`, in order, unquoted. */
function stack(name: string): string[] {
  const value = RULES.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1] ?? "";
  return value
    .split(",")
    .map((family) => family.trim().replace(/^"|"$/g, ""))
    .filter((family) => family !== "");
}

/** The declarations of every rule whose selector names `selector`. */
function declarationsFor(selector: RegExp): string[] {
  return [...RULES.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors = ""]) => selector.test(selectors))
    .map(([, , body = ""]) => body);
}

const covers = (spans: readonly Span[], point: number) =>
  spans.some(([from, to]) => from <= point && point <= to);

/**
 * The Chinese faces that draw the quotes full width. Microsoft YaHei UI is not
 * one: msyh.ttc holds it beside YaHei, with quotes 0.38 em wide.
 */
const CHINESE_FACES = ["PingFang SC", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei"];

/** What Chinese draws full width and a Latin face narrow: the dash, the quotes, the ellipsis. */
const PUNCTUATION = [0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026];

describe("the stylesheet", () => {
  it("hides Edge's own eye in a password input, which has a button of its own", () => {
    expect(CSS).toMatch(/input::-ms-reveal\s*\{\s*display:\s*none;\s*\}/);
  });
});

describe("Chinese text", () => {
  it("takes its punctuation from a Chinese face: no other family before the generic one may draw it", () => {
    const families = stack("font-sans-zh");
    const first = families.findIndex((family) => CHINESE_FACES.includes(family));
    const known = faces(CSS);
    // Whichever Chinese face is installed draws the punctuation, so every
    // family before the generic fallback is checked, not only those ahead of
    // the first Chinese face. A family not served from here, a system one,
    // may draw anything, so it counts as drawing the punctuation.
    const drawsIt = families.slice(0, -1).filter((family) => {
      if (CHINESE_FACES.includes(family)) return false;
      const spans = known.get(family);
      return spans === undefined || PUNCTUATION.some((point) => covers(spans, point));
    });

    expect({ hasChineseFace: first !== -1, drawsIt }).toEqual({
      hasChineseFace: true,
      drawsIt: [],
    });
  });

  it("is set in that stack wherever its language is, and other languages in theirs", () => {
    expect(RULES).toMatch(/\[lang\]:lang\(zh\)\s*\{\s*font-family:\s*var\(--font-sans-zh\);/);
    expect(RULES).toMatch(/\[lang\]:not\(:lang\(zh\)\)\s*\{\s*font-family:\s*var\(--font-sans\);/);
    expect(RULES).toMatch(
      /\.font-serif:lang\(zh\),\s*\.font-sans:lang\(zh\)\s*\{\s*font-family:\s*var\(--font-sans-zh\);/,
    );
  });

  it("leaves Latin quotes to the Latin stack, whose first face draws them", () => {
    const [first = ""] = stack("font-sans");
    const spans = faces(CSS).get(first) ?? [];

    expect(PUNCTUATION.every((point) => covers(spans, point))).toBe(true);
  });

  it("inherits its family from the root: the body and #root declare none", () => {
    const declared = declarationsFor(/(^|[\s,])(body|#root)\s*(,|$)/).filter((body) =>
      body.includes("font-family"),
    );

    expect(declared).toEqual([]);
  });
});
