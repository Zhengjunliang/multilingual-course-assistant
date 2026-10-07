/**
 * DESIGN.md's token block, written from src/index.css, and the file held to
 * its format.
 *
 *   node scripts/design-md.mjs            rewrite the block after a token changes
 *   node scripts/design-md.mjs --check    fail on a stale block or a linter finding
 *
 * DESIGN.md is Google's format (`@google/design.md`, outside the repository):
 * YAML tokens on top, prose below. The tokens are index.css's, converted, so
 * the block is generated and never edited by hand; the prose is written by
 * hand and kept as it is. The check fails while the block disagrees with
 * index.css, and on the linter's warnings as well as its errors, because the
 * rules that hold the file together — section order, a `primary` colour, the
 * contrast of each component — are warnings, and `designmd lint` exits 0 on
 * them.
 *
 * The format has one set of colours and no themes, so the dark theme's colours
 * carry a `-dark` suffix. Every colour has to be used by a component or the
 * linter calls it orphaned, so the components are the contrast pairs of
 * palette.mjs, one per pair and theme, which the linter measures again at 4.5:1;
 * a colour no pair uses (a hairline) gets a component of its own fill.
 */

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { lint } from "@google/design.md/linter";

import { declarations, hex, PAIRS, parseOklch, STYLESHEET, THEMES } from "./palette.mjs";

const DESIGN_MD = fileURLToPath(new URL("../../DESIGN.md", import.meta.url));

/** The sizes set in the serif: the reading and the headings. The rest is the controls' sans. */
const SERIF = new Set(["reading", "title", "display"]);

const suffix = (theme) => (theme.name === "light" ? "" : `-${theme.name}`);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const firstFamily = (stack) => stack.split(",")[0].trim().replaceAll('"', "");

function tokens() {
  const theme = declarations(STYLESHEET, "@theme {");
  const lines = [
    "version: 'alpha'",
    "name: 'Multilingual Course Assistant'",
    `description: ${quote("A university lab tool in the university's blue on greys tinted toward it, with a serif for reading. Generated from frontend/src/index.css by frontend/scripts/design-md.mjs.")}`,
    "colors:",
    `  primary: ${quote("{colors.accent}")}`,
  ];

  const used = new Set();
  const components = [];
  for (const each of THEMES) {
    const colours = declarations(STYLESHEET, each.selector);
    for (const [name, value] of colours) {
      lines.push(`  ${name}${suffix(each)}: ${quote(hex(parseOklch(value, name)))}`);
    }
    for (const { front, back } of PAIRS) {
      used.add(front).add(back);
      components.push(
        `  ${front}-on-${back}${suffix(each)}:`,
        `    backgroundColor: ${quote(`{colors.${back}${suffix(each)}}`)}`,
        `    textColor: ${quote(`{colors.${front}${suffix(each)}}`)}`,
      );
    }
    for (const name of colours.keys()) {
      if (used.has(name)) continue;
      components.push(
        `  ${name}-fill${suffix(each)}:`,
        `    backgroundColor: ${quote(`{colors.${name}${suffix(each)}}`)}`,
      );
    }
  }

  lines.push("typography:");
  for (const [name, size] of theme) {
    const match = /^text-([\w-]+)$/.exec(name);
    if (match === null || name.includes("--")) continue;
    const role = match[1];
    lines.push(
      `  ${role}:`,
      `    fontFamily: ${quote(firstFamily(theme.get(SERIF.has(role) ? "font-serif" : "font-sans")))}`,
      `    fontSize: ${quote(size)}`,
      `    lineHeight: ${quote(theme.get(`text-${role}--line-height`))}`,
    );
  }
  lines.push(
    "  reading-zh:",
    `    fontFamily: ${quote(firstFamily(theme.get("font-sans")))}`,
    `    fontSize: ${quote(theme.get("text-reading"))}`,
    `    lineHeight: ${theme.get("leading-reading-zh")}`,
  );

  for (const [section, prefix] of [
    ["rounded", "radius-"],
    ["spacing", "spacing-"],
  ]) {
    lines.push(`${section}:`);
    for (const [name, value] of theme) {
      if (name.startsWith(prefix)) lines.push(`  ${name.slice(prefix.length)}: ${quote(value)}`);
    }
  }

  lines.push("components:", ...components);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** The hand-written prose after the token block, kept byte for byte. */
function prose(markdown) {
  const end = markdown.indexOf("\n---\n", 3);
  if (!markdown.startsWith("---\n") || end === -1) {
    throw new Error("DESIGN.md has no token block to replace");
  }
  return markdown.slice(end + "\n---\n".length);
}

const current = readFileSync(DESIGN_MD, "utf8");
const next = tokens() + prose(current);

if (!process.argv.includes("--check")) {
  writeFileSync(DESIGN_MD, next);
  console.log("DESIGN.md: token block written from src/index.css");
  process.exit(0);
}

const problems = [];
if (next !== current) {
  problems.push("the token block is stale: run node scripts/design-md.mjs");
}
for (const { severity, path, message } of lint(current).findings) {
  if (severity === "error" || severity === "warning") {
    problems.push(`${severity}${path ? ` (${path})` : ""}: ${message}`);
  }
}
if (problems.length > 0) {
  console.error("DESIGN.md does not hold:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("DESIGN.md: tokens current, no linter finding.");
