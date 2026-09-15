/**
 * The three lists in index.css say the same thing, or the interface lies.
 *
 * A colour token exists three times: once in `:root`, once in
 * `[data-theme="dark"]`, and once in `@theme` as the `--color-*` alias Tailwind
 * turns into `bg-*` and `text-*` utilities. Nothing enforces that they agree,
 * and both ways of disagreeing fail silently:
 *
 * - a token declared in the two theme blocks but never aliased produces a class
 *   Tailwind does not emit at all, so `bg-sidebar` paints nothing and every
 *   gate stays green;
 * - an alias left behind after its token is deleted points at a variable that
 *   resolves to nothing, forever.
 *
 * `check-contrast.mjs` cannot see either: it reads the theme blocks and never
 * looks at `@theme`. Five lines here close the largest unwatched surface in the
 * stylesheet.
 *
 * Comments are stripped first for the same reason the gate strips them — the
 * block search below is `indexOf` on a literal, and prose that mentions
 * `:root` would be found before the rule does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…".
const CSS = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function block(selector: string): string {
  const start = CSS.indexOf(selector);
  expect(start, `no ${selector} block in index.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", start);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

/** The `--x` names a block declares, in source order. */
function declared(selector: string): string[] {
  const names: string[] = [];
  for (const match of block(selector).matchAll(/--([\w-]+)\s*:/g)) {
    names.push(match[1] ?? "");
  }
  return names;
}

/** The `--color-x: var(--y)` aliases, as the `y` they point at. */
function aliased(): string[] {
  const tokens: string[] = [];
  for (const match of block("@theme").matchAll(/--color-([\w-]+)\s*:\s*var\(--([\w-]+)\)/g)) {
    const [, alias, token] = match;
    expect(alias, "an alias is named after the token it points at").toBe(token);
    tokens.push(token ?? "");
  }
  return tokens;
}

const LIGHT = declared(":root");
const DARK = declared('[data-theme="dark"]');
const ALIASES = aliased();

describe("the palette", () => {
  it("declares the same tokens in both themes", () => {
    expect([...LIGHT].sort()).toEqual([...DARK].sort());
  });

  it("aliases every token it declares, and nothing else", () => {
    // Both directions on purpose. One catches a token no utility can reach; the
    // other catches an alias whose token has been deleted out from under it.
    expect([...ALIASES].sort()).toEqual([...LIGHT].sort());
  });

  it("names every token once", () => {
    expect(new Set(LIGHT).size).toBe(LIGHT.length);
    expect(new Set(ALIASES).size).toBe(ALIASES.length);
  });
});
