---
version: 'alpha'
name: 'UniGuide AI'
description: 'A university lab tool in the university''s blue on greys tinted toward it, with a serif for headings. Generated from frontend/src/index.css by frontend/scripts/design-md.mjs.'
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
    fontFamily: 'Figtree'
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
  entry-cat-sm: '9.75rem'
  entry-cat: '13rem'
components:
  ink-on-canvas:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
  canvas-on-ink:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.canvas}'
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
  warn-ink-on-surface:
    backgroundColor: '{colors.surface}'
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
  canvas-on-ink-dark:
    backgroundColor: '{colors.ink-dark}'
    textColor: '{colors.canvas-dark}'
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
  warn-ink-on-surface-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.warn-ink-dark}'
  accent-ink-on-warn-ink-dark:
    backgroundColor: '{colors.warn-ink-dark}'
    textColor: '{colors.accent-ink-dark}'
  line-fill-dark:
    backgroundColor: '{colors.line-dark}'
  warn-line-fill-dark:
    backgroundColor: '{colors.warn-line-dark}'
---

# UniGuide AI — design rules

The rules for how the interface looks, for whoever writes a screen, person or agent. The YAML block above is generated from [frontend/src/index.css](frontend/src/index.css) by `node scripts/design-md.mjs` (run from `frontend/`) and is never edited by hand; `npm run check:design` fails while it is stale or while the format's linter reports anything. The format is Google's DESIGN.md (outside the repository: the `@google/design.md` package), whose section titles the linter reads. Why the interface looks this way is [docs/decisions.md](docs/decisions.md), 2026-10-07; this file says how to apply it.

## Overview

A university lab tool that answers questions about a course and the campus, in the university's blue on greys tinted toward it, laid out and furnished like the AI products it measures itself against rather than like the university's website. Three rules hold it together:

- **The blue is for acting and for being somewhere**: a primary button, the focus ring, a link, the open conversation, the current page, the mark. The reading never wears it.
- **A serif for headings, one sans for the rest**: the headings in Fraunces; the answer and every control in Figtree, so the face does not change between the question box and the last line of the answer.
- **One cat**: Fumetto, the mark and the mascot, appears where a screen greets, waits, apologises or is lost, beside the words that say so, and nowhere for decoration alone.

## Colors

Every colour is a token with a job, named in `index.css` and used through its utility (`bg-surface`, `text-muted`), never as a raw value or a Tailwind palette step. The dark theme swaps the same names, so no component carries a second set of classes.

- **Grounds**: `canvas` is the page, under the grain: a fine noise in the accent's hue that never moves, at most 7 % over the light ground and 5.6 % over the dark one, painted with the ground by `bg-ground`. `surface` is a card or a field on it, `sidebar` the conversation column, and neither carries the grain. `mark` is the quiet fill of something under the pointer, a citation pill at rest and a source row under the pointer.
- **Text**: `ink` for everything read, `muted` for what supports it (a subtitle, an excerpt, an idle row). There is no third grey.
- **Lines**: `line` separates, and only that; a card is told apart by its outline, not by a step of fill.
- **The accent**: `accent` is the university website's blue, `accent-ink` the text that sits on it, `accent-soft` the tint behind where the reader is (the open conversation, the current management page, a state badge).
- **The warning**: `warn`, `warn-line` and `warn-ink` are the one other hue, for a failure and for confirming that something will be destroyed. Nothing else is red.

A citation pill says it can be clicked by its fill, never by colour: `mark` at rest, `ink` with canvas lettering under the pointer and while its card is open. Blue inside the prose would read as an ordinary link. Every pair of colours the interface puts together is listed in [frontend/scripts/palette.mjs](frontend/scripts/palette.mjs) and held to 4.5:1 in both themes by `npm run check:contrast`; a new pair is added there before it ships. Contrast is measured on the bare ground: on the grain's strongest pixel muted text, the faintest, keeps 6.2:1 in light and 7.9:1 in dark. axe cannot measure text over a background image, so `frontend/e2e/a11y.spec.ts` hides the grain before it runs and fails on any contrast axe leaves unmeasured.

## Typography

Two families, self-hosted under the SIL Open Font License, each followed by the system's Chinese faces:

- **Fraunces** (`font-serif`) for every heading at `text-title` or `text-display`. A screen's heading is never left in the controls' face; `src/theme/tokens.test.ts` fails on one.
- **Figtree** (`font-sans`, the page's default) for the answer at `text-reading`, in a column no wider than `max-w-reading` (720 px), and for controls, labels and the rest of the interface, at `text-body` and `text-caption`.

Five sizes carry the interface, and a sixth needs a reason: `caption`, `body`, `reading`, `title`, `display`. Chinese is not packaged: the system draws it, PingFang, Source Han or Microsoft YaHei. Wherever text says it is Chinese, `:lang(zh)` rules in `index.css` give it its own stack, `font-sans-zh`, headings and answers included, and give reading text the looser leading `reading-zh`. That stack starts with Figtree for Latin letters and digits alone and goes straight to the Chinese faces, so quotes, the ellipsis and the dash in Chinese are drawn by the Chinese face, the quotes full width, and its Latin letters match the interface instead of mixing Fraunces into the line; every family between Figtree and the generic fallback is a Chinese face that draws the quotes full width, since Segoe UI draws that punctuation narrow and so does Microsoft YaHei UI. Text in another language keeps its own stack inside the Chinese interface, and Chinese text gets the Chinese stack inside any other: the family follows `lang`, from the page's root down, and no element below the root declares one for itself. An answer therefore carries `lang` with the language it was written in, which is not always the interface's.

## Layout

Distances are named by what they are for, never by a step: `hair`, `tight`, `snug`, `gutter` and `room` for the rhythm inside and between things; `control-sm`, `control-icon`, `control` and `field` for the heights three components must agree on; `icon` and `icon-lg` for glyphs; `avatar` and `mascot` for the cat. A component that writes `px-4` or `h-10` fails the component layer's test.

The page never scrolls sideways at 375 px. The chat column and the composer share one width; the sidebar is a column from `lg` and a drawer below it. Below `sm` a data table stacks each row into a card, its cells labelled with their columns, because a phone has no width for five columns.

## Elevation & Depth

Two shadows, by height: `shadow-raised` for what rests on the page (a card, an outlined button), `shadow-overlay` for what floats above it (a dialog, a menu, the drawer). Both take the palette's hue, so they read as depth rather than dirt.

Three layers, by what sits over what: `z-lifted` for a control above its row's stretched link or a sticky table head, `z-backdrop` for the scrim behind a dialog, `z-floating` for what floats on it. A numbered `z-` index does not appear outside `index.css`.

Motion is spent through six durations (`duration-instant`, `-fast`, `-base`, `-slow`, `-reveal`, `-scene`), a `--stagger` between things arriving in a row, and four curves (`ease-standard`, `-out`, `-emphasized`, `-strong`), named in `index.css` beside the reference interface each was read off; `fast` and `standard` are what every `transition-colors` takes. Beyond colour, what moves is the living cat (under Components), the entry's intro writing its caption in (`blur-in`), the entry receding into the conversation, the conversation arriving and the question box travelling to its foot (`recede`, `arrive`, `travel`), the cat beside an answer thinking, a slow pulse while the answer is being prepared, the process line's words shimmering while the search runs (`shimmer`), the caret blinking after the last word of an answer being written (`caret-after`), the sources panel arriving from the right (`slide-in-right`), a field's label floating up and its line growing, the sign-in button's spinner and its check drawn in (`draw-in`), and the sign-in card shaking once when refused. Nothing moves for a reader whose system asks for reduced motion: what moves from script asks `lib/useReducedMotion.ts`, and `frontend/e2e/motion.spec.ts` checks every screen, the living cat's drawing included.

The pill (`bg-pill`) is the material of what floats in the page and takes input, the question box first: about half-white over the ground, a one-pixel inner highlight and a soft shadow, and no blur behind it, so the grain shows through it at about half its strength, as through glass laid on paper, where a card covers it.

🔜 (M4, #136) A first visit is guided once per audience, can be skipped and replayed from the account menu, and stays seen in the browser; an empty screen explains itself.

## Shapes

Four corners, by what wears them: `rounded-chip` for a short word (a code, a segment, the corner a message bubble points from), `rounded-control` for a control and a notice, `rounded-card` for a card, a window and a menu, `rounded-bubble` for a message and the composer. `rounded-full` is kept for what is round by shape: an avatar, a pill, a dot. Softer than the university website's square frames, which the interface must not imitate.

Icons come from Lucide, at `size-icon` beside text and `size-icon-lg` standing alone, and take the colour of the text beside them.

## Components

The primitives live in `frontend/src/components/ui/`, in the shadcn manner (Radix underneath, variants through `cva`), each exported from one file; `/styleguide` shows every one of them in both themes side by side, and its test fails on a primitive it does not show. Screens compose primitives and do not restyle them. A link that looks like a button uses `buttonVariants`. Bare text that can be pressed, the language menu in the visitor's header or the intro's Skip, shows `hover-sketch` on hover: a one-pixel ink ring turned two degrees, as if drawn round it by hand.

A hint is a `Tooltip`, the inverse of the page (canvas lettering on ink), opened by a resting pointer or by keyboard focus and closed by Escape; the browser's `title` attribute is never one, and a lint rule refuses it at commit time (`frontend/biome-plugins/no-title-attribute.grit`). A component's own prop for its heading is `heading`, never `title`; an element that truly needs the attribute, such as an iframe named by it, carries a suppression with its reason. A touch screen cannot open a hint, so a hint only repeats what the visible text or the accessible name says, as the copy button's hint repeats its name.

A `HoverCard` previews where a link goes: a card's surface, opened by a pointer resting on the link or by keyboard focus, closed by Escape or by leaving. Radix keeps it out of the tab order, so it never holds anything that is not reachable elsewhere, and a touch follows the link.

An answer is drawn in one order (`features/chat/TurnView.tsx`), after ChatGPT and Open WebUI, with Perplexity's process line (read 11 October 2026):

- **The process line** (`ProcessLine.tsx`), one line above the answer at `text-body` in `muted`: a search icon and the seconds counting, its words shimmering, while the search runs; then a check, the server's seconds and a chevron, folded, opening onto where it searched, how many excerpts it read and each source once. The router's reason is never shown.
- **The answer**, in Figtree at `text-reading`, its citations as pills: `rounded-full`, `text-caption`, the source's short name (the host without `www.`, or the slide's page), a run of them as «name +N». A pill links to its source, a web page at its passage and a slide at its page, and previews every source of its run in a `HoverCard`; its accessible name starts with what it shows.
- **Under a settled answer**, a ghost icon button that copies the answer without its markers, and the sources button, an outlined pill with up to three stacked source marks, which opens the sources panel: a `Sheet` from the right, full width below `sm`, the cited sources first and the rest after them under a heading of their own, never marked as unused, and every source in one list when the answer cited none. Closing it gives focus back to the button.

A password is typed into `components/PasswordField.tsx`, with an eye inside the field, after Edge's own reveal and Material 3's secure text field: a toggle button whose name, "Show password", never changes, its state in `aria-pressed`, which a screen reader announces. Pressing it with a pointer leaves the focus in the field. The letters are hidden again when the form is sent and when the page returns from the back-forward cache, and Edge's own eye in the field is hidden, so there is one way to show them.

The sign-in and registration forms sit on a card with no border (`routes/AuthLayout.tsx`): `surface`, `rounded-bubble` and `shadow-overlay`, the living cat's head sitting on its top edge. Their fields are `components/LineField.tsx`, after Material 3's filled text field: an underline in `muted`, which is the field's only edge, the label inside the field floating up to four fifths of its size on focus, once filled or once a password manager has filled it, and an accent line growing from the left while the focus is in the field, `warn-ink` while the field is refused. The submit button is a full pill: an arrow slides in under the pointer or the focus, a spinner turns while the server decides and a check is drawn in when it accepts, after Stripe Checkout's pay button, and it is `aria-disabled` from the send until the page leaves. What the server refused is a line in `warn-ink` after a disc with "!", tied to its field by `aria-describedby`; a refused sign-in shakes the card once, after the macOS sign-in window, and empties the password. The registration's password carries a hint of its minimum length.

Fumetto is drawn by `components/Mascot.tsx` from the one drawing in `frontend/src/brand/fumetto.ts`, always decorative (`aria-hidden`), in the accent's line:

| Pose | Where |
| ---- | ----- |
| `avatar` | Beside every answer, at `size-avatar`; the mark (`MascotMark`, the head on its tile) beside the app's name in the sidebar |
| `welcome` | The brand files; the living cat smiles with its eyes and wears its stars |
| `thinking` | Beside an answer until its first word, pulsing |
| `error` | Beside an answer that failed, and on the panel of a page that broke |
| `notFound` | An address the application does not have, and a staff page whose object cannot be read |

Where a screen greets, the entry and the sign-in and registration screens, Fumetto is alive: `components/LivingMascot.tsx`, at `w-entry-cat` (`w-entry-cat-sm` on a phone), its behaviour in `components/mascotLife.ts`. Awake, it blinks, flicks an ear, sways the bubble's tip and breathes, and its eyes go to the pointer, to the caret of the focused field, or to the question box when nobody moves. It smiles while the pointer is on an element marked `data-mascot-cheer`, the send button, and when it hops as a question goes. After ten idle seconds it yawns and sleeps, eyes closed and a "z" rising, until a pointer, key or wheel wakes it with a double blink. With reduced motion it does not move, and that setting is the only stop: nothing on the page stops it, which falls short of the stop control WCAG 2.2.2 asks of motion that lasts beyond five seconds. The face beside an answer is the motionless `Mascot`. A visitor's first visit opens on an intro, once and skippable: the cat drawn in one stroke, then the caption written in six languages before the interface's own, its name the settled caption throughout.

A pose appears only where words beside it say what it means. Colours, sizes, clear space and what the mark may never be combined with are in [frontend/brand/README.md](frontend/brand/README.md).

A screen with nothing of its own to show is one panel, `components/StatusPanel.tsx`: the pose at `size-mascot`, a heading, one sentence and the ways on. An address that names no page shows it with the way to the start; a page that broke while drawing shows it with a reload first and the start second, its words a live region, inside the frame when only the page broke and over the window when the frame did. No screen of this kind is drawn another way, and none is blank.

## Do's and Don'ts

- Do spend colour, distance, corners, shadows and layers through their tokens; don't write a raw value or a Tailwind step where a token exists.
- Do keep an answer's text in `ink`; don't colour anything inside the reading blue unless it is a link.
- Do put an answer's sources after it, behind its pills and its sources button; don't put a strip of sources, a route or a reason above it.
- Do give `accent-soft` to where the reader is; don't give the accent to a setting that is merely true, such as the chosen language.
- Do keep the warning hue for failure and destruction; don't use it for emphasis.
- Do add a colour pair to `palette.mjs` before a screen composes it.
- Do show the ground with `bg-ground`; don't paint `bg-canvas`, which leaves a flat patch in the grain.
- Do let a table stack on a phone; don't let a page scroll sideways.
- Do let a control act and say what will follow, as deleting the conversation being answered says that its answer stops; don't disable a control to say why it cannot act, and where it truly cannot, say why beside it. A control is disabled only while its own request is on its way, so that it is not sent twice.
- Don't use the university's mark, its lettering or its page furniture (a blue band, uppercase navigation, square frames): only its blue.
- Don't move anything a reader with reduced motion would see move.
