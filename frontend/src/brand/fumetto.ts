/**
 * Fumetto, the project's cat: its drawing, once, for every place it appears.
 *
 * The React component (components/Mascot.tsx) draws from these shapes, and so
 * does scripts/brand.mjs, which writes the SVG files in frontend/brand/ and the
 * icons in frontend/public/. Two copies of a path drift the first time one is
 * touched, so there is one, here. No imports and only erasable type syntax:
 * Node runs this file as it is when the script imports it.
 *
 * Everything sits on a 64-unit grid. The head is a speech bubble whose tail
 * trails from the lower left; a pose changes the eyes, the mouth and one small
 * sign beside the head, never the head. The pupils are separate circles cut out
 * of the eyes by a mask rather than painted in a background colour, so the cat
 * reads on any ground, and a pupil can later move on its own (#135).
 *
 * Drawn by Claude and chosen by the author, released under CC0:
 * frontend/brand/PROVENANCE.md.
 */

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface Drawing {
  /** Filled in ink and thickened by a hairline, the pupils cut out of them. */
  eyes: readonly string[];
  /** Holes in the eyes. */
  pupils: readonly Circle[];
  /** Mouth, whiskers and line signs, stroked a little thinner than the head. */
  strokes: readonly string[];
  /** Solid signs in ink: stars, a drop, the dots of a thought. */
  fills: readonly string[];
  dots: readonly Circle[];
}

export const HEAD =
  "M13.5 30.5C12.2 23.5 12.8 16.6 15 10.8C19 13.4 22.4 16.4 25 19.4C29.8 17.9 35.2 17.9 40 19.2C43 15.6 46.6 12.6 50.6 10.6C52.4 16.4 52.6 23 51.2 29.6C55.2 34.6 55.6 42 51.6 47.4C46.6 53.8 38.6 55.8 31.8 55.6C26.4 55.5 21.2 54.6 17.4 52.8L10.4 58.8L12.6 49.6C9.4 44.4 9.6 35.8 13.5 30.5Z";

/** Half-lidded: a flat lid line across the top of each eye. */
const LIDDED = [
  "M19.4 35.8L29.6 35.2C29.8 39.8 27.8 42.6 24.6 42.6C21.4 42.6 19.4 39.8 19.4 35.8Z",
  "M35 35.2L45.2 35.8C45.2 39.8 43.2 42.6 40 42.6C36.8 42.6 34.8 39.8 35 35.2Z",
];
/** The lids tilted down at the outer corners. */
const DROOPING = [
  "M19.4 37.4L29.6 34.6C29.8 39.6 27.8 42.6 24.6 42.6C21.4 42.6 19.4 40.2 19.4 37.4Z",
  "M35 34.6L45.2 37.4C45.2 40.2 43.2 42.6 40 42.6C36.8 42.6 34.8 39.6 35 34.6Z",
];
const MOUTH = "M29.4 46.8Q31 48.8 32.4 46.8Q33.8 48.8 35.4 46.8";
/** On the right cheek only: the bubble's tail takes the left. */
const WHISKERS = "M52.2 40.8L56.8 40.2M52 43.8L56.4 44.2";

const pupils = (dx: number, dy: number): Circle[] => [
  { cx: 24.6 + dx, cy: 39.8 + dy, r: 1.7 },
  { cx: 40 + dx, cy: 39.8 + dy, r: 1.7 },
];

export const POSES = {
  /** The mark and the face beside an answer: sleepy, looking at the reader. */
  avatar: { eyes: LIDDED, pupils: pupils(0, 0), strokes: [MOUTH, WHISKERS], fills: [], dots: [] },
  /** An empty chat and the sign-in screens: eyes closed in a smile, two stars. */
  welcome: {
    eyes: [],
    pupils: [],
    strokes: [
      "M19.8 39.6Q24.6 34.4 29.4 39.6",
      "M35.2 39.6Q40 34.4 44.8 39.6",
      "M29.4 46.4Q31 49.2 32.4 46.4Q33.8 49.2 35.4 46.4",
      WHISKERS,
    ],
    fills: [
      "M7.5 6L8.9 10.6L13.5 12L8.9 13.4L7.5 18L6.1 13.4L1.5 12L6.1 10.6Z",
      "M58 2.5L58.8 5.2L61.5 6L58.8 6.8L58 9.5L57.2 6.8L54.5 6L57.2 5.2Z",
    ],
    dots: [],
  },
  /** Before the first word of an answer: looking up, a thought rising. */
  thinking: {
    eyes: LIDDED,
    pupils: pupils(2.4, -2.2),
    strokes: ["M30.4 47.4L34.4 47.4", WHISKERS],
    fills: [],
    dots: [
      { cx: 54.8, cy: 24.6, r: 1.4 },
      { cx: 58.2, cy: 18.4, r: 2 },
      { cx: 60.6, cy: 10.4, r: 2.7 },
    ],
  },
  /** An answer that failed or was refused: drooping, a drop of sweat. */
  error: {
    eyes: DROOPING,
    pupils: pupils(0, 0.6),
    strokes: ["M28.4 48.4Q30.4 46.6 32.4 48.4Q34.4 50.2 36.4 48.4", WHISKERS],
    fills: [
      "M57 20.5C57 20.5 53.8 25.2 53.8 27.4A3.2 3.2 0 0 0 60.2 27.4C60.2 25.2 57 20.5 57 20.5Z",
    ],
    dots: [],
  },
  /** A page that is not there: looking aside, a question mark. */
  notFound: {
    eyes: LIDDED,
    pupils: pupils(-2.4, -0.4),
    strokes: [MOUTH, WHISKERS, "M54.6 9.6A4.2 4.2 0 1 1 59.6 13.8C58.4 14.4 58 15.2 58 16.6"],
    fills: [],
    dots: [{ cx: 58, cy: 21, r: 1.5 }],
  },
} as const satisfies Record<string, Drawing>;

export type Pose = keyof typeof POSES;

/** The line, and the thinner line of a pose's mouth, whiskers and signs. */
export const STROKE = 3;
export const DETAIL_STROKE = 2.4;

/**
 * The palette the files are written in, as hex because an SVG or PNG file has
 * no access to index.css. Each is index.css's token converted with the
 * contrast gate's own arithmetic (scripts/check-contrast.mjs): `--accent` and
 * `--canvas` in both themes.
 */
export const BLUE = "#004C7F";
export const BLUE_DARK = "#62A4DF";
export const CANVAS = "#FAFCFE";
export const CANVAS_DARK = "#07090C";

const circle = ({ cx, cy, r }: Circle, fill: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

/** A pose as an SVG document, in one ink on a transparent ground. */
export function lineSvg(pose: Pose, ink: string): string {
  const drawing: Drawing = POSES[pose];
  const line = `stroke="${ink}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const eyes =
    drawing.eyes.length === 0
      ? ""
      : `<mask id="pupils"><rect width="64" height="64" fill="#fff"/>${drawing.pupils.map((p) => circle(p, "#000")).join("")}</mask>` +
        `<g mask="url(#pupils)" fill="${ink}" stroke="${ink}" stroke-width="1" stroke-linejoin="round">${drawing.eyes.map((d) => `<path d="${d}"/>`).join("")}</g>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<path d="${HEAD}" ${line} stroke-width="${STROKE}"/>`,
    eyes,
    ...drawing.strokes.map((d) => `<path d="${d}" ${line} stroke-width="${DETAIL_STROKE}"/>`),
    ...drawing.fills.map((d) => `<path d="${d}" fill="${ink}"/>`),
    ...drawing.dots.map((dot) => circle(dot, ink)),
    "</svg>\n",
  ].join("");
}

export interface TileOptions {
  /** The square behind the head, or `null` for the head alone. */
  tile: string | null;
  ink: string;
  /** Corner radius of the tile in grid units: 14 for the icon, 0 where the platform rounds it. */
  radius: number;
  /** The head's size against the 64-unit tile. */
  scale: number;
  /** A `<style>` the document carries, for icon.svg's dark rule. */
  style?: string;
}

/** The head's bounding box on the grid, measured with getBBox(): x 10.4 to 54.4, y 10.6 to 58.8. */
const HEAD_CENTRE = { x: 32.4, y: 34.7 };

/** Where the head sits on a tile at `scale`: centred on its own box, not on the grid. */
export function placement(scale: number): string {
  const x = (32 - HEAD_CENTRE.x * scale).toFixed(2);
  const y = (32 - HEAD_CENTRE.y * scale).toFixed(2);
  return `translate(${x} ${y}) scale(${scale})`;
}

/** The pupils of the mark, larger than a pose's, so a 16 px icon keeps them. */
export const MARK_PUPILS: readonly Circle[] = POSES.avatar.pupils.map((p) => ({
  ...p,
  r: p.r + 0.5,
}));

/**
 * The mark: the head filled in on a tile, for the favicon and the app icons,
 * where a line one pixel wide would vanish. The mouth and whiskers are dropped
 * for the same reason. Without a tile the eyes are cut out, so the head stays
 * one colour on any ground. The classes are for icon.svg's dark rule: `tile`
 * paints the square, `cut` the eyes cut back to it, `ink` the head and pupils.
 */
export function tileSvg({ tile, ink, radius, scale, style }: TileOptions): string {
  const { eyes } = POSES.avatar;
  const eye = (d: string, paint: string, extra = "") =>
    `<path${extra} d="${d}" fill="${paint}" stroke="${paint}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const face =
    tile === null
      ? `<mask id="eyes"><rect width="64" height="64" fill="#fff"/>${eyes.map((d) => eye(d, "#000")).join("")}${MARK_PUPILS.map((p) => circle(p, "#fff")).join("")}</mask>` +
        `<path d="${HEAD}" fill="${ink}" mask="url(#eyes)"/>`
      : `<path class="ink" d="${HEAD}" fill="${ink}"/>` +
        eyes.map((d) => eye(d, tile, ' class="cut"')).join("") +
        MARK_PUPILS.map((p) => circle(p, ink).replace("<circle", '<circle class="ink"')).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    style === undefined ? "" : `<style>${style}</style>`,
    tile === null
      ? ""
      : `<rect class="tile" width="64" height="64" rx="${radius}" fill="${tile}"/>`,
    `<g transform="${placement(scale)}">${face}</g>`,
    "</svg>\n",
  ].join("");
}

const WHITE = "#FFFFFF";

/** The icon on its rounded tile: the favicon, icon.svg, and the 192 and 512 px icons. */
export const ICON: TileOptions = { tile: BLUE, ink: WHITE, radius: 14, scale: 0.875 };

/**
 * Square and smaller where the platform cuts its own shape. iOS rounds the
 * corners of an apple-touch-icon; a maskable icon may be cut to a circle 80%
 * of its width, and at 0.72 the ear tips stay inside it.
 */
export const SQUARE: TileOptions = { tile: BLUE, ink: WHITE, radius: 0, scale: 0.72 };

/** icon.svg follows the browser's theme: the dark accent's tile, the dark canvas's head. */
const DARK_RULE =
  `@media (prefers-color-scheme: dark){` +
  `.tile{fill:${BLUE_DARK}}.cut{fill:${BLUE_DARK};stroke:${BLUE_DARK}}.ink{fill:${CANVAS_DARK}}}`;

/** `notFound` is fumetto-not-found.svg. */
const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The web app manifest, listing the icons scripts/brand.mjs rasterises. */
function manifest(): string {
  const app = {
    name: "Multilingual Course Assistant",
    short_name: "Course Assistant",
    start_url: "/",
    display: "standalone",
    background_color: CANVAS,
    theme_color: BLUE,
    icons: [
      { src: "icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "icon-512.png", type: "image/png", sizes: "512x512" },
      { src: "icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
  return `${JSON.stringify(app, null, 2)}\n`;
}

/**
 * Every text file the drawing is published as, by path under frontend/: the
 * mark with its square, one-colour and reversed forms and each pose for light
 * and dark grounds in brand/; the browser's icon and the manifest in public/.
 * scripts/brand.mjs writes them, and rasterises the PNG icons from the same
 * tiles; fumetto.test.ts holds the files on disk to them, so a change to a
 * tile, a pose or a colour fails until the script has run.
 */
export function writtenFiles(): Record<string, string> {
  const files: Record<string, string> = {
    "brand/fumetto-mark.svg": tileSvg(ICON),
    "brand/fumetto-mark-square.svg": tileSvg(SQUARE),
    "brand/fumetto-mark-mono.svg": tileSvg({ tile: null, ink: "#000000", radius: 0, scale: 1 }),
    "brand/fumetto-mark-reversed.svg": tileSvg({ tile: null, ink: WHITE, radius: 0, scale: 1 }),
    "public/icon.svg": tileSvg({ ...ICON, style: DARK_RULE }),
    "public/manifest.webmanifest": manifest(),
  };
  for (const pose of Object.keys(POSES) as Pose[]) {
    files[`brand/fumetto-${kebab(pose)}.svg`] = lineSvg(pose, BLUE);
    files[`brand/fumetto-${kebab(pose)}-dark.svg`] = lineSvg(pose, BLUE_DARK);
  }
  return files;
}
