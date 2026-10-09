---
version: 'alpha'
name: 'Multilingual Course Assistant'
description: 'A university lab tool in the university''s blue on greys tinted toward it, with a serif for reading. Generated from frontend/src/index.css by frontend/scripts/design-md.mjs.'
colors:
  primary: '{colors.accent}'
  canvas: '#FAFCFE'
  surface: '#FFFFFF'
  sidebar: '#F2F5F8'
  ink: '#1D2227'
  muted: '#565C61'
  line: '#DBDEE2'
  accent: '#004C7F'
  accent-ink: '#FFFFFF'
  accent-soft: '#DEEDFB'
  mark: '#E8ECEF'
  warn: '#FFEDEB'
  warn-line: '#E54B50'
  warn-ink: '#A2031F'
  canvas-dark: '#07090C'
  surface-dark: '#0E1216'
  sidebar-dark: '#14191E'
  ink-dark: '#ECEFF1'
  muted-dark: '#A3A8AE'
  line-dark: '#242A2F'
  accent-dark: '#62A4DF'
  accent-ink-dark: '#040A11'
  accent-soft-dark: '#152D43'
  mark-dark: '#1D2227'
  warn-dark: '#271514'
  warn-line-dark: '#FF5B5B'
  warn-ink-dark: '#FFB7B2'
typography:
  caption:
    fontFamily: 'Figtree'
    fontSize: '0.75rem'
    lineHeight: '1rem'
  body:
    fontFamily: 'Figtree'
    fontSize: '0.875rem'
    lineHeight: '1.25rem'
  title:
    fontFamily: 'Fraunces'
    fontSize: '1.125rem'
    lineHeight: '1.75rem'
  display:
    fontFamily: 'Fraunces'
    fontSize: '1.875rem'
    lineHeight: '2.25rem'
  reading:
    fontFamily: 'Fraunces'
    fontSize: '1rem'
    lineHeight: '1.625rem'
  reading-zh:
    fontFamily: 'Figtree'
    fontSize: '1rem'
    lineHeight: 1.8
rounded:
  chip: '0.375rem'
  control: '0.625rem'
  card: '0.875rem'
  bubble: '1.25rem'
spacing:
  hair: '0.25rem'
  tight: '0.5rem'
  snug: '0.75rem'
  gutter: '1rem'
  room: '1.5rem'
  control-sm: '2rem'
  control-icon: '2.25rem'
  control: '2.5rem'
  field: '5rem'
  icon: '1rem'
  icon-lg: '1.25rem'
  avatar: '1.75rem'
  mascot: '6rem'
components:
  ink-on-canvas:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
  ink-on-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
  muted-on-canvas:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.muted}'
  muted-on-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.muted}'
  ink-on-sidebar:
    backgroundColor: '{colors.sidebar}'
    textColor: '{colors.ink}'
  muted-on-sidebar:
    backgroundColor: '{colors.sidebar}'
    textColor: '{colors.muted}'
  ink-on-mark:
    backgroundColor: '{colors.mark}'
    textColor: '{colors.ink}'
  muted-on-mark:
    backgroundColor: '{colors.mark}'
    textColor: '{colors.muted}'
  accent-ink-on-accent:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
  accent-on-canvas:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.accent}'
  accent-on-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.accent}'
  accent-on-accent-soft:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.accent}'
  warn-ink-on-warn:
    backgroundColor: '{colors.warn}'
    textColor: '{colors.warn-ink}'
  accent-ink-on-warn-ink:
    backgroundColor: '{colors.warn-ink}'
    textColor: '{colors.accent-ink}'
  line-fill:
    backgroundColor: '{colors.line}'
  warn-line-fill:
    backgroundColor: '{colors.warn-line}'
  ink-on-canvas-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.ink-dark}'
  ink-on-surface-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-canvas-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.muted-dark}'
  muted-on-surface-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.muted-dark}'
  ink-on-sidebar-dark:
    backgroundColor: '{colors.sidebar-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-sidebar-dark:
    backgroundColor: '{colors.sidebar-dark}'
    textColor: '{colors.muted-dark}'
  ink-on-mark-dark:
    backgroundColor: '{colors.mark-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-mark-dark:
    backgroundColor: '{colors.mark-dark}'
    textColor: '{colors.muted-dark}'
  accent-ink-on-accent-dark:
    backgroundColor: '{colors.accent-dark}'
    textColor: '{colors.accent-ink-dark}'
  accent-on-canvas-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.accent-dark}'
  accent-on-surface-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.accent-dark}'
  accent-on-accent-soft-dark:
    backgroundColor: '{colors.accent-soft-dark}'
    textColor: '{colors.accent-dark}'
  warn-ink-on-warn-dark:
    backgroundColor: '{colors.warn-dark}'
    textColor: '{colors.warn-ink-dark}'
  accent-ink-on-warn-ink-dark:
    backgroundColor: '{colors.warn-ink-dark}'
    textColor: '{colors.accent-ink-dark}'
  line-fill-dark:
    backgroundColor: '{colors.line-dark}'
  warn-line-fill-dark:
    backgroundColor: '{colors.warn-line-dark}'
---

# Multilingual Course Assistant — design rules

The rules for how the interface looks, for whoever writes a screen, person or agent. The YAML block above is generated from [frontend/src/index.css](frontend/src/index.css) by `node scripts/design-md.mjs` (run from `frontend/`) and is never edited by hand; `npm run check:design` fails while it is stale or while the format's linter reports anything. The format is Google's DESIGN.md (outside the repository: the `@google/design.md` package), whose section titles the linter reads. Why the interface looks this way is [docs/decisions.md](docs/decisions.md), 2026-10-07; this file says how to apply it.

## Overview

A university lab tool that answers questions about a course and the campus, in the university's blue on greys tinted toward it, laid out and furnished like the AI products it measures itself against rather than like the university's website. Three rules hold it together:

- **The blue is for acting and for being somewhere**: a primary button, the focus ring, a link, the open conversation, the current page, the mark. The reading never wears it.
- **A serif for reading, a sans for working**: the answer and the headings in Fraunces, every control in Figtree.
- **One cat**: Fumetto, the mark and the mascot, appears where a screen greets, waits, apologises or is lost, beside the words that say so, and nowhere for decoration alone.

## Colors

Every colour is a token with a job, named in `index.css` and used through its utility (`bg-surface`, `text-muted`), never as a raw value or a Tailwind palette step. The dark theme swaps the same names, so no component carries a second set of classes.

- **Grounds**: `canvas` is the page, `surface` a card or a field on it, `sidebar` the conversation column. `mark` is the quiet fill of something under the pointer, a citation pill and a lit source card.
- **Text**: `ink` for everything read, `muted` for what supports it (a subtitle, an excerpt, an idle row). There is no third grey.
- **Lines**: `line` separates, and only that; a card is told apart by its outline, not by a step of fill.
- **The accent**: `accent` is the university website's blue, `accent-ink` the text that sits on it, `accent-soft` the tint behind where the reader is (the open conversation, the current management page, a state badge).
- **The warning**: `warn`, `warn-line` and `warn-ink` are the one other hue, for a failure and for confirming that something will be destroyed. Nothing else is red.

A citation and its source card are linked by fill, never by colour: the pill and the lit card wear `mark`, the card is ringed in `ink`. Blue there would read as a link to somewhere else. Every pair of colours the interface puts together is listed in [frontend/scripts/palette.mjs](frontend/scripts/palette.mjs) and held to 4.5:1 in both themes by `npm run check:contrast`; a new pair is added there before it ships.

## Typography

Two families, self-hosted under the SIL Open Font License, each followed by the system's Chinese faces:

- **Fraunces** (`font-serif`) for the answer at `text-reading` and for every heading at `text-title` or `text-display`. A screen's heading is never left in the controls' face; `src/theme/tokens.test.ts` fails on one.
- **Figtree** (`font-sans`, the body's default) for controls, labels and the rest of the interface, at `text-body` and `text-caption`.

Five sizes carry the interface, and a sixth needs a reason: `caption`, `body`, `reading`, `title`, `display`. Chinese is not packaged: the system draws it, PingFang, Source Han or Microsoft YaHei. Wherever text says it is Chinese, `:lang(zh)` rules in `index.css` give it the sans stack, headings and answers included, so its Latin letters and digits match the Chinese face instead of mixing Fraunces into the line, and give reading text the looser leading `reading-zh`. An answer therefore carries `lang` with the language it was written in, which is not always the interface's.

## Layout

Distances are named by what they are for, never by a step: `hair`, `tight`, `snug`, `gutter` and `room` for the rhythm inside and between things; `control-sm`, `control-icon`, `control` and `field` for the heights three components must agree on; `icon` and `icon-lg` for glyphs; `avatar` and `mascot` for the cat. A component that writes `px-4` or `h-10` fails the component layer's test.

The page never scrolls sideways at 375 px. The chat column and the composer share one width; the sidebar is a column from `lg` and a drawer below it. Below `sm` a data table stacks each row into a card, its cells labelled with their columns, because a phone has no width for five columns.

## Elevation & Depth

Two shadows, by height: `shadow-raised` for what rests on the page (a card, an outlined button), `shadow-overlay` for what floats above it (a dialog, a menu, the drawer). Both take the palette's hue, so they read as depth rather than dirt.

Three layers, by what sits over what: `z-lifted` for a control above its row's stretched link or a sticky table head, `z-backdrop` for the scrim behind a dialog, `z-floating` for what floats on it. A numbered `z-` index does not appear outside `index.css`.

Motion is one duration and one curve, the defaults every `transition-colors` takes, named in `index.css`. The one other movement is the cat thinking, a slow pulse while an answer is being prepared. Nothing moves for a reader whose system asks for reduced motion. Further effects are chosen in issue #135, each naming its duration and curve beside the defaults.

🔜 (M4, #135) Three.js loads only on the entry screens, the empty chat and sign-in, after the first paint, and steps down when frames drop. 🔜 (M4, #136) A first visit is guided once per audience, can be skipped and replayed from the account menu, and stays seen in the browser; an empty screen explains itself.

## Shapes

Four corners, by what wears them: `rounded-chip` for a short word (a code, a segment, the corner a message bubble points from), `rounded-control` for a control and a notice, `rounded-card` for a card, a window and a menu, `rounded-bubble` for a message and the composer. `rounded-full` is kept for what is round by shape: an avatar, a pill, a dot. Softer than the university website's square frames, which the interface must not imitate.

Icons come from Lucide, at `size-icon` beside text and `size-icon-lg` standing alone, and take the colour of the text beside them.

## Components

The primitives live in `frontend/src/components/ui/`, in the shadcn manner (Radix underneath, variants through `cva`), each exported from one file; `/styleguide` shows every one of them in both themes side by side, and its test fails on a primitive it does not show. Screens compose primitives and do not restyle them. A link that looks like a button uses `buttonVariants`.

Fumetto is drawn by `components/Mascot.tsx` from the one drawing in `frontend/src/brand/fumetto.ts`, always decorative (`aria-hidden`), in the accent's line:

| Pose | Where |
| ---- | ----- |
| `avatar` | Beside every answer, at `size-avatar`; the mark (`MascotMark`, the head on its tile) beside the app's name in the sidebar |
| `welcome` | The empty chat and the sign-in and registration screens, at `size-mascot` |
| `thinking` | Beside an answer until its first word, pulsing |
| `error` | Beside an answer that failed, and on the panel of a page that broke |
| `notFound` | An address the application does not have, and a staff page whose object cannot be read |

A pose appears only where words beside it say what it means. Colours, sizes, clear space and what the mark may never be combined with are in [frontend/brand/README.md](frontend/brand/README.md).

A screen with nothing of its own to show is one panel, `components/StatusPanel.tsx`: the pose at `size-mascot`, a heading, one sentence and the ways on. An address that names no page shows it with the way to the start; a page that broke while drawing shows it with a reload first and the start second, its words a live region, inside the frame when only the page broke and over the window when the frame did. No screen of this kind is drawn another way, and none is blank.

## Do's and Don'ts

- Do spend colour, distance, corners, shadows and layers through their tokens; don't write a raw value or a Tailwind step where a token exists.
- Do keep an answer's text in `ink`; don't colour anything inside the reading blue unless it is a link.
- Do give `accent-soft` to where the reader is; don't give the accent to a setting that is merely true, such as the chosen language.
- Do keep the warning hue for failure and destruction; don't use it for emphasis.
- Do add a colour pair to `palette.mjs` before a screen composes it.
- Do let a table stack on a phone; don't let a page scroll sideways.
- Don't use the university's mark, its lettering or its page furniture (a blue band, uppercase navigation, square frames): only its blue.
- Don't move anything a reader with reduced motion would see move.
