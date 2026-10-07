/**
 * The cat's text files on disk are what its drawing writes.
 *
 * scripts/brand.mjs writes them, and a drawing changed without a run of it
 * would leave the favicon and the brand folder showing the old cat while the
 * interface shows the new one. The PNG files are not compared: they come out of the
 * same run as the SVGs, and comparing them would need the rasteriser here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CANVAS, CANVAS_DARK, writtenFiles } from "./fumetto";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…".
const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));

function onDisk(path: string): string | null {
  try {
    return readFileSync(FRONTEND + path, "utf8");
  } catch {
    return null;
  }
}

describe("the cat's files", () => {
  it("are what the drawing writes (else run node scripts/brand.mjs)", () => {
    const stale = Object.entries(writtenFiles())
      .filter(([path, svg]) => onDisk(path) !== svg)
      .map(([path]) => path);

    expect(stale).toEqual([]);
  });

  it("share the page's theme colours with index.html", () => {
    // The browser's bar takes the canvas of the theme the system asks for;
    // fumetto.ts holds the hex, and the contrast gate holds it to index.css.
    const html = onDisk("index.html") ?? "";
    const themeColours = [...html.matchAll(/name="theme-color" content="(#[0-9A-F]{6})"/g)].map(
      ([, hex]) => hex,
    );

    expect(themeColours).toEqual([CANVAS, CANVAS_DARK]);
  });
});
