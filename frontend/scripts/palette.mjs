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
  {
    front: "ink",
    back: "canvas",
    min: TEXT,
    where: "index.css body rule, ConversationSidebar.tsx brand and conversation titles",
  },
  {
    front: "canvas",
    back: "ink",
    min: TEXT,
    where:
      "tooltip.tsx content, sonner.tsx toast, AnswerMarkdown.tsx citation pill under the pointer or open",
  },
  {
    front: "ink",
    back: "surface",
    min: TEXT,
    where: "card.tsx card body, dialog.tsx and alert-dialog.tsx body",
  },
  {
    front: "muted",
    back: "canvas",
    min: TEXT,
    where:
      "EntryScreen.tsx and StatusPanel.tsx subtitle, ChatShell.tsx icon-only buttons (button.tsx ghost), ConversationList.tsx a row's time and group headings",
  },
  {
    front: "muted",
    back: "surface",
    min: TEXT,
    where:
      "SourcesPanel.tsx where a source is and its excerpt, LineField.tsx a field's underline and label, kbd.tsx a key's cap",
  },
  {
    front: "ink",
    back: "mark",
    min: TEXT,
    where: "chip.tsx and avatar.tsx neutral tone, SourcesPanel.tsx row title under the pointer",
  },
  {
    front: "muted",
    back: "mark",
    min: TEXT,
    where:
      "AnswerMarkdown.tsx citation pill at rest, SourcesPanel.tsx row under the pointer, count.tsx, avatar-stack.tsx the rest as +N",
  },
  {
    front: "accent-ink",
    back: "accent",
    min: TEXT,
    where: "button.tsx primary variant, count.tsx accent tone",
  },
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
    where:
      "field.tsx a focused field's edge, AnswerMarkdown.tsx a source's open link in its hover card",
  },
  {
    front: "accent",
    back: "accent-soft",
    min: TEXT,
    where:
      "badge.tsx, chip.tsx and avatar.tsx accent tone, button.tsx soft variant, dialog.tsx disc, sonner.tsx success disc, ConversationSidebar.tsx open conversation, ManagementNav.tsx current page",
  },
  {
    front: "warn-ink",
    back: "warn",
    min: TEXT,
    where:
      "TurnView.tsx failure box, button.tsx warn variant, chip.tsx warn tone, dialog.tsx warn disc, sonner.tsx failure disc",
  },
  {
    front: "muted",
    back: "tint",
    min: TEXT,
    where: "toggle-group.tsx an option not chosen, card.tsx CardFooter's caption",
  },
  {
    front: "ink",
    back: "accent-soft",
    min: TEXT,
    where: "banner.tsx info title",
  },
  {
    front: "muted",
    back: "accent-soft",
    min: TEXT,
    where: "banner.tsx info sentence",
  },
  {
    front: "ink",
    back: "warn",
    min: TEXT,
    where: "banner.tsx warn title",
  },
  {
    front: "muted",
    back: "warn",
    min: TEXT,
    where: "banner.tsx warn sentence",
  },
  {
    front: "accent",
    back: "warn",
    min: TEXT,
    where: "StatusPanel.tsx the cat on the warning's disc",
  },
  {
    front: "accent",
    back: "tint",
    min: TEXT,
    where: "hover-card.tsx an icon in its head (routes/styleguide/overlays.tsx)",
  },
  {
    front: "ink",
    back: "tint",
    min: TEXT,
    where:
      "card.tsx CardFooter, hover-card.tsx head, routes/styleguide/basics.tsx the --tint swatch",
  },
  {
    front: "warn-ink",
    back: "surface",
    min: TEXT,
    where:
      "field.tsx FieldError on the sign-in card and in a dialog, LineField.tsx a refused field's line",
  },
  {
    front: "warn-ink",
    back: "canvas",
    min: TEXT,
    where: "routes/styleguide/fields.tsx FieldError on the page",
  },
];

/**
 * The translucent tokens (index.css, the themes' second blocks), each over a
 * ground it is laid on, with the tokens written on it. A tint has no contrast
 * of its own: what a reader sees is the tint over that ground, so the gate
 * lays one over the other before it measures, and holds the result a step
 * apart from the ground (check-contrast.mjs, the ladder), since a row under
 * the pointer that cannot be told from its neighbours has not changed.
 */
export const TINTS = [
  {
    tint: "hover",
    ground: "canvas",
    fronts: ["ink", "muted"],
    where:
      "button.tsx ghost and outline variants under the pointer, on the page; ConversationList.tsx and ManagementNav.tsx a row under the pointer, its title and its icons",
  },
  {
    tint: "hover",
    ground: "surface",
    fronts: ["ink"],
    where: "button.tsx ghost and outline variants under the pointer, in a card or a dialog",
  },
  {
    tint: "hover",
    ground: "tint",
    fronts: ["ink"],
    where:
      "toggle-group.tsx an option under the pointer, dialog.tsx an outlined button in the foot under the pointer",
  },
  {
    tint: "selected",
    ground: "canvas",
    fronts: ["accent"],
    where:
      "ConversationList.tsx the open conversation, ManagementNav.tsx the current page, routes/styleguide/basics.tsx the --selected swatch",
  },
  {
    tint: "selected",
    ground: "surface",
    fronts: ["accent"],
    where: "button.tsx soft variant under the pointer",
  },
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
export function declarations(css, selector, nth = 1) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let start = -1;
  for (let found = 0; found < nth; found += 1) {
    start = source.indexOf(selector, start + 1);
    if (start === -1) throw new Error(`no block ${nth} of ${selector} in index.css`);
  }
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

/**
 * The translucent colours of a theme, from its second block: each written as
 * `color-mix(in oklab, var(--x) N%, transparent)`, a token of the first block
 * at a strength, returned as { of: "x", alpha }. Mixing with `transparent` in
 * a premultiplied space leaves the colour whole and scales its alpha, so that
 * is all the mix means. The block's other declarations, the pill and the
 * grain, are not colours this gate measures, and are skipped.
 */
export function translucents(css, selector) {
  const found = new Map();
  for (const [name, value] of declarations(css, selector, 2)) {
    if (!value.startsWith("color-mix(")) continue;
    const match = /^color-mix\(in oklab, var\(--([\w-]+)\) ([\d.]+)%, transparent\)$/.exec(value);
    if (match === null)
      throw new Error(`--${name} is not a token mixed with transparent: ${value}`);
    found.set(name, { of: match[1], alpha: Number(match[2]) / 100 });
  }
  return found;
}

/**
 * What a translucent colour shows over a ground, as gamma-encoded channels:
 * a browser lays one colour over another in gamma-encoded sRGB, so the mix is
 * taken there.
 */
export function over(colour, alpha, ground) {
  const top = srgb(colour);
  return srgb(ground).map((channel, index) => alpha * top[index] + (1 - alpha) * channel);
}

/** The OKLab lightness of gamma-encoded channels, the inverse of `linearRgb` for L alone. */
export function lightness(channels) {
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const lCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone;
}

/** Gamma-encoded channels in the six-digit hex the brand files use. */
export function hexOf(channels) {
  return `#${channels
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** The colour as the screen shows it, in the six-digit hex the brand files use. */
export function hex(colour) {
  return hexOf(srgb(colour));
}
