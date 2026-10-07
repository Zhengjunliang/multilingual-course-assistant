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

import { BLUE, BLUE_DARK, CANVAS, CANVAS_DARK } from "../src/brand/fumetto.ts";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…".
const STYLESHEET = fileURLToPath(new URL("../src/index.css", import.meta.url));

/**
 * Text needs 4.5:1 (WCAG 1.4.3). A control's own shape needs only 3:1 (1.4.11),
 * but the accent that draws the focus ring also writes links and chips on the
 * same grounds, so every pair here is held to the text threshold.
 */
const TEXT = 4.5;

/**
 * The palette has one hue, the accent's, and these hold it there.
 *
 * Three rules, each catching one way a single-hue palette drifts. A token that
 * has a hue at all has the accent's, within a few degrees, so a second hue
 * cannot creep in; `--warn*` is the one other hue and is exempt. The greys stay
 * under a chroma that reads as grey however they lean. And the accent keeps a
 * chroma that reads as a colour: a lightened accent turns grey long before it
 * fails a contrast pair, and that is the rule a legitimate edit can trip.
 *
 * Below `HUELESS` a colour has no hue worth comparing: oklch(100% 0 0) carries
 * hue 0 only because the syntax wants a number there.
 */
const HUELESS = 0.002;
const HUE_TOLERANCE = 4;
const GREY_MAX_CHROMA = 0.02;
const ACCENT_MIN_CHROMA = 0.08;

/** The greys, and the ink that sits on the accent. `--accent-soft` is a tint, not a grey. */
const GREYS = ["canvas", "surface", "sidebar", "ink", "muted", "line", "accent-ink", "mark"];

/** Tokens with a hue of their own, exempt from the one-hue rule. */
const OTHER_HUE = ["warn", "warn-line", "warn-ink"];

const PAIRS = [
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
  { front: "accent", back: "accent-soft", min: TEXT, where: "badge.tsx state word" },
  { front: "warn-ink", back: "warn", min: TEXT, where: "TurnView.tsx:110 failure box" },
  { front: "accent-ink", back: "warn-ink", min: TEXT, where: "button.tsx destructive variant" },
];

/**
 * Two fills that meet with no border between them.
 *
 * Contrast ratio is the wrong instrument here: it asks whether a letter can be
 * read, and these pairs are asking whether a region exists at all. A step of
 * two points of OKLCH lightness is what separates "the row under the pointer"
 * from "nothing happened". The pairs are only those the interface composes
 * *without* a border — a card is told apart by its outline, not its fill, so
 * `--surface` against `--canvas` is one point apart on purpose and is not here.
 */
const STEP = 2;

const LADDER = [
  { a: "mark", b: "sidebar", where: "ConversationSidebar.tsx open conversation and hover" },
  { a: "mark", b: "surface", where: "locale-switch.tsx:36 track, button.tsx:13 ghost hover" },
  { a: "mark", b: "canvas", where: "AnswerStream.tsx:91 citation pill in the answer" },
];

/**
 * The cat's files are written in hex (src/brand/fumetto.ts), because an SVG or
 * a PNG cannot read a stylesheet. Each hex has to be its token converted, or a
 * change to the palette leaves the favicon in the old blue.
 */
const THEMES = [
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
function declarations(css, selector) {
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

/** The colour as the screen shows it, in the six-digit hex the brand files use. */
function hex(colour) {
  const encode = (channel) =>
    channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  const byte = (channel) => Math.round(Math.min(1, Math.max(0, encode(channel))) * 255);
  return `#${linearRgb(colour)
    .map((channel) => byte(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
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

  // Every check records a row, so `--verbose` prints exactly as many lines as
  // the tally claims. It used to print twenty-two and say twenty-six, because
  // the chroma checks never reached `measured` — a gate that miscounts itself
  // is hard to trust about anything else.
  const record = (label, detail, margin) => {
    checked += 1;
    measured.push({ label: `${theme.name}: ${label}`, detail, margin });
  };

  for (const pair of PAIRS) {
    const ratio = contrast(colour(pair.front), colour(pair.back));
    const label = `--${pair.front} on --${pair.back}`;
    record(label, `${ratio.toFixed(2)}:1 (needs ${pair.min})`, ratio / pair.min);
    if (ratio < pair.min) {
      failures.push(
        `${theme.name}: ${label} is ${ratio.toFixed(2)}:1, ` +
          `needs ${pair.min}:1 (${pair.where})`,
      );
    }
  }

  const accent = colour("accent");
  record(
    "--accent chroma",
    `${accent.c} (at least ${ACCENT_MIN_CHROMA})`,
    accent.c / ACCENT_MIN_CHROMA,
  );
  if (accent.c < ACCENT_MIN_CHROMA) {
    failures.push(
      `${theme.name}: --accent has chroma ${accent.c}, a colour needs ${ACCENT_MIN_CHROMA}`,
    );
  }

  for (const name of GREYS) {
    const { c } = colour(name);
    record(
      `--${name} chroma`,
      `${c} (at most ${GREY_MAX_CHROMA})`,
      c === 0 ? Infinity : GREY_MAX_CHROMA / c,
    );
    if (c > GREY_MAX_CHROMA) {
      failures.push(`${theme.name}: --${name} has chroma ${c}, at most ${GREY_MAX_CHROMA} is grey`);
    }
  }

  for (const name of raw.keys()) {
    if (OTHER_HUE.includes(name)) continue;
    const { c, h } = colour(name);
    if (c < HUELESS) continue;
    // Hue is an angle: 359 and 1 are two degrees apart, not 358.
    const off = Math.min(Math.abs(h - accent.h), 360 - Math.abs(h - accent.h));
    record(
      `--${name} hue`,
      `${h}, ${off} from the accent's (at most ${HUE_TOLERANCE})`,
      off === 0 ? Infinity : HUE_TOLERANCE / off,
    );
    if (off > HUE_TOLERANCE) {
      failures.push(
        `${theme.name}: --${name} has hue ${h}, ${off} degrees from the accent's ${accent.h}`,
      );
    }
  }

  for (const [name, written] of Object.entries(theme.brand)) {
    const converted = hex(colour(name));
    record(
      `--${name} in the brand files`,
      `${written} (is ${converted})`,
      written === converted ? 1 : 0,
    );
    if (written !== converted) {
      failures.push(
        `${theme.name}: --${name} converts to ${converted}, src/brand/fumetto.ts says ${written}; ` +
          "update it and run node scripts/brand.mjs",
      );
    }
  }

  for (const rung of LADDER) {
    // Whole points, not floats: see the note above the palette in index.css.
    const delta = Math.abs(Math.round(colour(rung.a).l * 100) - Math.round(colour(rung.b).l * 100));
    const label = `--${rung.a} against --${rung.b}`;
    record(label, `${delta} points (needs ${STEP})`, delta / STEP);
    if (delta < STEP) {
      failures.push(
        `${theme.name}: ${label} is ${delta} point(s) apart, ` + `needs ${STEP} (${rung.where})`,
      );
    }
  }
}

if (verbose) {
  for (const { label, detail } of [...measured].sort((a, b) => a.margin - b.margin)) {
    console.log(`  ${detail} — ${label}`);
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${checked} colour checks failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`${checked} colour checks in ${THEMES.length} themes, all clear.`);
