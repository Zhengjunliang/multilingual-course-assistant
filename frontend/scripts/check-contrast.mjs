/**
 * Every colour pair the interface actually puts together clears WCAG AA, in
 * both themes.
 *
 * The pairs below are not a plausible list: each one names the file and line
 * that composes those two tokens. A pair nobody renders is not checked, and a
 * pair that starts being rendered has to be added here — which is the only way
 * this file stays a measurement rather than a ritual.
 *
 * The values are read out of src/index.css instead of being repeated, because a
 * copy is a thing that drifts. Zero dependencies, like check-i18n.mjs: the
 * conversion is thirty lines of arithmetic and a package for it would be a
 * dependency to audit for the rest of the project's life.
 *
 * What is deliberately *not* gated: `--line` against the two backgrounds. Those
 * are hairline borders that separate a card from the page. WCAG 1.4.11 covers
 * non-text content "required to understand the content" — a focus ring is, a
 * decorative rule is not, and holding a 1px divider to 3:1 would mean drawing
 * every card in a box dark enough to shout. Focus outlines and the highlight
 * ring, which are the same token used to tell a reader where they are, are
 * gated.
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…".
const STYLESHEET = fileURLToPath(new URL("../src/index.css", import.meta.url));

/** Text needs 4.5:1 (WCAG 1.4.3); a control's own shape needs 3:1 (1.4.11). */
const TEXT = 4.5;
const SHAPE = 3;

/** Below this the "accent" is a grey, whatever else it is. */
const MIN_CHROMA = 0.08;

const PAIRS = [
  { front: "ink", back: "canvas", min: TEXT, where: "index.css body rule" },
  { front: "ink", back: "surface", min: TEXT, where: "AppHeader.tsx:42, card.tsx:19" },
  { front: "muted", back: "canvas", min: TEXT, where: "ChatPage.tsx empty state" },
  { front: "muted", back: "surface", min: TEXT, where: "CitationList.tsx:108" },
  { front: "accent-ink", back: "accent", min: TEXT, where: "button.tsx:11 default variant" },
  { front: "accent-text", back: "canvas", min: TEXT, where: "AnswerStream.tsx:35 link hover" },
  { front: "accent-text", back: "surface", min: TEXT, where: "AnswerStream.tsx:35 inside a card" },
  { front: "accent", back: "canvas", min: SHAPE, where: "button.tsx:7 focus outline" },
  { front: "accent", back: "surface", min: SHAPE, where: "CitationList.tsx:90 highlight ring" },
  { front: "mark-ink", back: "mark", min: TEXT, where: "TurnView.tsx:56 question bubble" },
  { front: "warn-ink", back: "warn", min: TEXT, where: "TurnView.tsx:80 failure box" },
];

const THEMES = [
  { name: "light", selector: ":root" },
  { name: "dark", selector: '[data-theme="dark"]' },
];

/**
 * The custom properties of one theme block.
 *
 * Deliberately naive: it takes the text between the selector and the first `}`.
 * These blocks are flat lists of declarations and nothing nests inside them, so
 * a real parser would buy nothing. If that ever stops being true, this throws
 * on the missing token rather than reading a wrong one.
 */
function declarations(css, selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no ${selector} block in index.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const block = css.slice(open + 1, close);

  const found = new Map();
  for (const [, name, value] of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(name, value.trim());
  }
  return found;
}

/** `oklch(52% 0.11 196)` -> { l: 0.52, c: 0.11, h: 196 }. */
function parseOklch(value, name) {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(value);
  if (match === null) throw new Error(`--${name} is not an oklch() triple: ${value}`);
  const [, l, c, h] = match;
  return { l: Number(l) / 100, c: Number(c), h: Number(h) };
}

/** OKLCH -> linear sRGB, via OKLab and the LMS cone responses. */
function linearRgb({ l, c, h }) {
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
 * Relative luminance, WCAG 2.x.
 *
 * The round trip through gamma-encoded sRGB is not ceremony: an oklch() colour
 * can sit outside the sRGB gamut, and clamping there is what a screen does.
 * Taking luminance straight from unclamped linear values would score a colour
 * the reader can never actually see.
 */
function luminance(colour) {
  const encode = (channel) =>
    channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  const decode = (channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  const [r, g, b] = linearRgb(colour)
    .map(encode)
    .map((channel) => Math.min(1, Math.max(0, channel)))
    .map(decode);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(front, back) {
  const a = luminance(front);
  const b = luminance(back);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const css = readFileSync(STYLESHEET, "utf8");
const failures = [];
const measured = [];
let checked = 0;

// `--verbose` prints every ratio with its margin. Tuning a colour by rerunning a
// pass/fail gate is guesswork; the number that matters is which pair is closest
// to its threshold, and that one is invisible while everything passes.
const verbose = process.argv.includes("--verbose");

for (const theme of THEMES) {
  const raw = declarations(css, theme.selector);
  const colour = (name) => {
    const value = raw.get(name);
    if (value === undefined) throw new Error(`--${name} is missing from ${theme.selector}`);
    return parseOklch(value, name);
  };

  for (const pair of PAIRS) {
    const ratio = contrast(colour(pair.front), colour(pair.back));
    checked += 1;
    measured.push({
      label: `${theme.name}: --${pair.front} on --${pair.back}`,
      ratio,
      min: pair.min,
    });
    if (ratio < pair.min) {
      failures.push(
        `${theme.name}: --${pair.front} on --${pair.back} is ${ratio.toFixed(2)}:1, ` +
          `needs ${pair.min}:1 (${pair.where})`,
      );
    }
  }

  // An accent with no chroma is the defect this palette started from: `--accent`
  // held the same value as `--ink`, so the interface had no colour of its own.
  // Distinctness alone would not catch it — in the dark theme the two were
  // already different values, and both were grey.
  for (const name of ["accent", "accent-text"]) {
    const { c } = colour(name);
    checked += 1;
    if (c < MIN_CHROMA) {
      failures.push(`${theme.name}: --${name} has chroma ${c}, needs at least ${MIN_CHROMA}`);
    }
  }
}

if (verbose) {
  for (const { label, ratio, min } of [...measured].sort(
    (a, b) => a.ratio / a.min - b.ratio / b.min,
  )) {
    console.log(`  ${ratio.toFixed(2)}:1 (needs ${min}) — ${label}`);
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${checked} colour checks failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`${checked} colour checks in ${THEMES.length} themes, all clear.`);
