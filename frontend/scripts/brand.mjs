/**
 * Writes every file of the cat out of its one drawing, src/brand/fumetto.ts.
 *
 *   node scripts/brand.mjs            (from frontend/, after changing the drawing)
 *
 * frontend/brand/ gets the SVGs a person uses by hand; frontend/public/ gets
 * what browsers and platforms ask for, the set Evil Martians' "How to Favicon
 * in 2024" settles on: favicon.ico at 32 px, icon.svg with its own dark rule, a
 * 180 px apple-touch-icon, 192 and 512 px icons with a maskable 512, the
 * manifest that lists them, and a 1200 x 630 image for link previews. Nothing
 * is exported by hand, so a change to the drawing is one run away from every
 * file. src/brand/fumetto.test.ts fails when a written SVG or the manifest
 * disagrees with the drawing; the PNG files come from the same tiles in the
 * same run, the square ones from fumetto-mark-square.svg's.
 *
 * Node runs fumetto.ts as it is, stripping its types (Node 22.18 and later).
 * @resvg/resvg-js rasterises: one native binary per platform and no browser.
 * It cannot read woff2, which is why the preview image carries the cat and no
 * lettering; a link preview prints the page's title beside the image anyway.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

import { BLUE, ICON, lineSvg, SQUARE, tileSvg, writtenFiles } from "../src/brand/fumetto.ts";

const FRONTEND = fileURLToPath(new URL("../", import.meta.url));

function write(path, content) {
  mkdirSync(dirname(FRONTEND + path), { recursive: true });
  writeFileSync(FRONTEND + path, content);
  console.log(path);
}

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}

/** One PNG in an ICO container, which every browser since IE 11 reads. */
function ico(pngBytes, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(pngBytes.length, 14);
  header.writeUInt32LE(22, 18); // the image starts after this header
  return Buffer.concat([header, pngBytes]);
}

/** The welcome pose in white, centred on a blue ground. */
function preview(width, height) {
  const size = Math.round(height * 0.62);
  const pose = lineSvg("welcome", "#FFFFFF").replace(
    'viewBox="0 0 64 64"',
    `x="${(width - size) / 2}" y="${(height - size) / 2}" width="${size}" height="${size}" viewBox="0 0 64 64"`,
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="${BLUE}"/>${pose}</svg>`
  );
}

for (const [path, text] of Object.entries(writtenFiles())) write(path, text);
write("public/favicon.ico", ico(png(tileSvg(ICON), 32), 32));
write("public/apple-touch-icon.png", png(tileSvg(SQUARE), 180));
write("public/icon-192.png", png(tileSvg(ICON), 192));
write("public/icon-512.png", png(tileSvg(ICON), 512));
write("public/icon-maskable-512.png", png(tileSvg(SQUARE), 512));
write("public/og.png", png(preview(1200, 630), 1200));
