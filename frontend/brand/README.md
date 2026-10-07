# Fumetto, the project's cat

The mark of Multilingual Course Assistant and the mascot of its interface: a cat whose head is a speech bubble. Released under CC0 ([LICENSE](LICENSE)); how it was made is in [PROVENANCE.md](PROVENANCE.md).

## The files

| File | Use |
| ---- | --- |
| `fumetto-mark.svg` | The mark: the head filled in white on a blue tile. Favicons, app icons, a project's avatar |
| `fumetto-mark-mono.svg` | The head in black alone, eyes cut out. Print in one colour, stamps, embossing |
| `fumetto-mark-reversed.svg` | The head in white alone, eyes cut out. On a photograph or a dark or blue ground |
| `fumetto-<pose>.svg` | A pose as a blue line, for light grounds |
| `fumetto-<pose>-dark.svg` | The same pose in the lighter blue, for dark grounds |

The poses are `avatar`, `welcome`, `thinking`, `error` and `not-found`. The browser and platform icons built from the mark sit in `frontend/public/`: `favicon.ico`, `icon.svg`, `apple-touch-icon.png`, the three `icon-*.png` and `og.png`, the image a link preview shows.

## Using it

- **Colours**: `#004C7F` on light grounds and `#62A4DF` on dark ones, the interface's accent in its two themes, taken from the university website's blue as a colour and nothing more; white; black for one-colour print. No other colour, gradient or outline.
- **Smallest size**: 16 px for the mark, the size at which its eyes read; 24 px for a pose, below which its line closes up.
- **Clear space**: a quarter of the mark's width on every side, kept free of text and other signs.
- **As drawn**: no stretching, rotating, redrawing or lettering inside the head. A new pose is drawn in `src/brand/fumetto.ts` with the others, never beside them.
- **No endorsement**: Fumetto is this project's sign, not the University of Florence's. It is never set beside or combined with the university's mark, or with the university's name in the university's own lettering, in a way that suggests the university made or approves the project.

## Changing it

The drawing lives once, in `frontend/src/brand/fumetto.ts`; the interface draws from it and so does `frontend/scripts/brand.mjs`, which writes every file listed above. After a change, from `frontend/`:

```shell
node scripts/brand.mjs
```

`src/brand/fumetto.test.ts` fails while an SVG here disagrees with the drawing, and `npm run check:contrast` fails while its blue disagrees with `src/index.css`.
