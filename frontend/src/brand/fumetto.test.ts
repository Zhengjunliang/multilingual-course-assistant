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

import { APP_NAME, CANVAS, CANVAS_DARK, HEAD, outline, writtenFiles } from "./fumetto";

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

  it("draw the head from the same outline the living cat turns", () => {
    expect(outline()).toBe(HEAD);
    expect(HEAD).toBe(
      "M13.5 30.5C12.2 23.5 12.8 16.6 15 10.8C19 13.4 22.4 16.4 25 19.4C29.8 17.9 35.2 17.9 40 19.2C43 15.6 46.6 12.6 50.6 10.6C52.4 16.4 52.6 23 51.2 29.6C55.2 34.6 55.6 42 51.6 47.4C46.6 53.8 38.6 55.8 31.8 55.6C26.4 55.5 21.2 54.6 17.4 52.8L10.4 58.8L12.6 49.6C9.4 44.4 9.6 35.8 13.5 30.5Z",
    );
  });

  it("name the page as the manifest does", () => {
    const html = onDisk("index.html") ?? "";

    expect(html.match(/<title>(.*)<\/title>/)?.[1]).toBe(APP_NAME);
  });
});

describe("the outline's rigs", () => {
  const numbers = (path: string) => path.match(/-?[\d.]+/g) ?? [];
  const moved = (turned: string) => {
    const rest = numbers(HEAD);
    return numbers(turned).flatMap((value, index) => (value === rest[index] ? [] : [index]));
  };

  it("turn an ear without touching the other ear or the tail", () => {
    const left = moved(outline({ earLeft: 0.2 }));
    const right = moved(outline({ earRight: 0.2 }));

    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.filter((index) => right.includes(index))).toEqual([]);
  });

  it("sway the tail by its tip alone", () => {
    // tailTip is the 26th point of the path: numbers 50 and 51.
    expect(moved(outline({ tail: 0.3 }))).toEqual([50, 51]);
  });
});
