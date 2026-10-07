/**
 * The palette as index.css declares it: the two themes, the colour pairs the
 * interface puts together, and the arithmetic that turns an oklch() token into
 * what a screen shows. check-contrast.mjs holds the pairs to WCAG AA and
 * design-md.mjs writes them into DESIGN.md; both read them from here.
 *
 * The pairs are not a plausible list: each one names the file and line that
 * composes those two tokens. A pair nobody renders is not checked, and a pair
 * that starts being rendered has to be added here — which is the only way the
 * gate stays a measurement rather than a ritual.
 *
 * The values are read out of src/index.css instead of being repeated, because a
 * copy is a thing that drifts. Zero dependencies, like check-i18n.mjs: the
 * conversion is thirty lines of arithmetic and a package for it would be a
 * dependency to audit for the rest of the project's life.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BLUE, BLUE_DARK, CANVAS, CANVAS_DARK } from "../src/brand/fumetto.ts";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…".
export const STYLESHEET = readFileSync(
  fileURLToPath(new URL("../src/index.css", import.meta.url)),
  "utf8",
);

/**
 * Text needs 4.5:1 (WCAG 1.4.3). A control's own shape needs only 3:1 (1.4.11),
 * but the accent that draws the focus ring also writes links and chips on the
 * same grounds, so every pair here is held to the text threshold.
 */
export const TEXT = 4.5;

export const PAIRS = [
  { front: "ink", back: "canvas", min: TEXT, where: "index.css body rule" },
  { front: "ink", back: "surface", min: TEXT, where: "card.tsx:19 card body" },
  { front: "muted", back: "canvas", min: TEXT, where: "EmptyState.tsx:39 subtitle" },
  { front: "muted", back: "surface", min: TEXT, where: "CitationList.tsx:113 excerpt" },
  { front: "ink", back: "sidebar", min: TEXT, where: "ConversationSidebar.tsx title and rows" },
  { front: "muted", back: "sidebar", min: TEXT, where: "ConversationSidebar.tsx idle row" },
  { front: "ink", back: "mark", min: TEXT, where: "AnswerStream.tsx:91 citation pill" },
  { front: "muted", back: "mark", min: TEXT, where: "CitationList.tsx:113 on a lit card" },
  { front: "accent-ink", back: "accent", min: TEXT, where: "button.tsx default variant" },
  {
    front: "accent",
    back: "canvas",
    min: TEXT,
    where: "button.tsx focus outline, breadcrumb.tsx link under the pointer",
  },
  {
    front: "accent",
    back: "surface",
    min: TEXT,
    where: "input.tsx focus outline and border, suggestion.tsx chip under the pointer",
  },
  {
    front: "accent",
    back: "accent-soft",
    min: TEXT,
    where:
      "badge.tsx state word, ConversationSidebar.tsx open conversation, ManagementNav.tsx current page",
  },
  { front: "warn-ink", back: "warn", min: TEXT, where: "TurnView.tsx:110 failure box" },
  { front: "accent-ink", back: "warn-ink", min: TEXT, where: "button.tsx destructive variant" },
];

/**
 * The cat's files are written in hex (src/brand/fumetto.ts), because an SVG or
 * a PNG cannot read a stylesheet. Each hex has to be its token converted, or a
 * change to the palette leaves the favicon in the old blue.
 */
export const THEMES = [
  { name: "light", selector: ":root", brand: { accent: BLUE, canvas: CANVAS } },
  {
    name: "dark",
    selector: '[data-theme="dark"]',
    brand: { accent: BLUE_DARK, canvas: CANVAS_DARK },
  },
];

/**
 * The custom properties of one theme block.
 *
 * Deliberately naive: it takes the text between the selector and the first `}`.
 * These blocks are flat lists of declarations and nothing nests inside them, so
 * a real parser would buy nothing. If that ever stops being true, this throws
 * on the missing token rather than reading a wrong one.
 *
 * Comments go first, and that is not tidiness. The search below is a plain
 * `indexOf` for the selector, so the *prose* above a theme block competes with
 * the block itself: a sentence in index.css that happens to mention `:root`
 * would send this function into the comment and out again at the comment's own
 * closing brace, finding no declarations and reporting a missing token — or,
 * worse, finding some. Stripping comments first makes that impossible instead
 * of leaving it to whoever edits the file next to remember.
 */
export function declarations(css, selector) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`no ${selector} block in index.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  const block = source.slice(open + 1, close);

  const found = new Map();
  for (const [, name, value] of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(name, value.trim());
  }
  return found;
}

/** `oklch(52% 0.11 196)` -> { l: 0.52, c: 0.11, h: 196 }. */
export function parseOklch(value, name) {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(value);
  if (match === null) throw new Error(`--${name} is not an oklch() triple: ${value}`);
  const [, l, c, h] = match;
  return { l: Number(l) / 100, c: Number(c), h: Number(h) };
}

/** OKLCH -> linear sRGB, via OKLab and the LMS cone responses. */
export function linearRgb({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    -1.268438004 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  ];
}

/**
 * Gamma-encoded sRGB channels, clamped to the gamut.
 *
 * The clamp is not ceremony: an oklch() colour can sit outside the sRGB gamut,
 * and clamping there is what a screen does. Scoring the unclamped value would
 * measure a colour the reader can never actually see.
 */
export function srgb(colour) {
  const encode = (channel) =>
    channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  return linearRgb(colour).map((channel) => Math.min(1, Math.max(0, encode(channel))));
}

/** The colour as the screen shows it, in the six-digit hex the brand files use. */
export function hex(colour) {
  return `#${srgb(colour)
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}
