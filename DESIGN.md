---
version: 'alpha'
name: 'UniGuide AI'
description: 'A university lab tool in the university''s blue on greys tinted toward it, in one sans from headings to answers. Generated from frontend/src/index.css by frontend/scripts/design-md.mjs.'
colors:
  primary: '{colors.accent}'
  canvas: '#FAFCFE'
  surface: '#FFFFFF'
  ink: '#1D2227'
  muted: '#565C61'
  line: '#DBDEE2'
  accent: '#004C7F'
  accent-ink: '#FFFFFF'
  accent-soft: '#DEEDFB'
  mark: '#E8ECEF'
  hairline: '#E5E8EC'
  tint: '#F6F9FB'
  warn: '#FFEDEB'
  warn-line: '#E54B50'
  warn-ink: '#A2031F'
  hover-over-canvas: '#EBF1F6'
  hover-over-surface: '#F0F4F7'
  hover-over-tint: '#E8EEF4'
  selected-over-canvas: '#DFE9F0'
  selected-over-surface: '#E3EBF1'
  canvas-dark: '#07090C'
  surface-dark: '#0E1216'
  ink-dark: '#ECEFF1'
  muted-dark: '#A3A8AE'
  line-dark: '#242A2F'
  accent-dark: '#62A4DF'
  accent-ink-dark: '#040A11'
  accent-soft-dark: '#152D43'
  mark-dark: '#1D2227'
  hairline-dark: '#1C2024'
  tint-dark: '#0A0E11'
  warn-dark: '#271514'
  warn-line-dark: '#FF5B5B'
  warn-ink-dark: '#FFB7B2'
  hover-over-canvas-dark: '#0F171F'
  hover-over-surface-dark: '#161F28'
  hover-over-tint-dark: '#121B24'
  selected-over-canvas-dark: '#162430'
  selected-over-surface-dark: '#1C2B38'
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
    fontFamily: 'Figtree'
    fontSize: '1.125rem'
    lineHeight: '1.75rem'
  display:
    fontFamily: 'Figtree'
    fontSize: '1.875rem'
    lineHeight: '2.25rem'
    letterSpacing: '-0.02em'
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
  control-xs: '1.75rem'
  control-sm: '2rem'
  control-icon: '2.25rem'
  control: '2.5rem'
  sidebar: '16.5rem'
  rail: '3.75rem'
  bar: '0.1875rem'
  table-head: '2.25rem'
  table-row: '3.375rem'
  icon: '1rem'
  icon-lg: '1.25rem'
  icon-xl: '2.25rem'
  avatar-sm: '1.5rem'
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
  muted-on-tint:
    backgroundColor: '{colors.tint}'
    textColor: '{colors.muted}'
  ink-on-accent-soft:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.ink}'
  muted-on-accent-soft:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.muted}'
  ink-on-warn:
    backgroundColor: '{colors.warn}'
    textColor: '{colors.ink}'
  muted-on-warn:
    backgroundColor: '{colors.warn}'
    textColor: '{colors.muted}'
  accent-on-warn:
    backgroundColor: '{colors.warn}'
    textColor: '{colors.accent}'
  accent-on-tint:
    backgroundColor: '{colors.tint}'
    textColor: '{colors.accent}'
  ink-on-tint:
    backgroundColor: '{colors.tint}'
    textColor: '{colors.ink}'
  warn-ink-on-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.warn-ink}'
  warn-ink-on-canvas:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.warn-ink}'
  ink-on-hover-over-canvas:
    backgroundColor: '{colors.hover-over-canvas}'
    textColor: '{colors.ink}'
  muted-on-hover-over-canvas:
    backgroundColor: '{colors.hover-over-canvas}'
    textColor: '{colors.muted}'
  ink-on-hover-over-surface:
    backgroundColor: '{colors.hover-over-surface}'
    textColor: '{colors.ink}'
  muted-on-hover-over-surface:
    backgroundColor: '{colors.hover-over-surface}'
    textColor: '{colors.muted}'
  ink-on-hover-over-tint:
    backgroundColor: '{colors.hover-over-tint}'
    textColor: '{colors.ink}'
  accent-on-selected-over-canvas:
    backgroundColor: '{colors.selected-over-canvas}'
    textColor: '{colors.accent}'
  accent-on-selected-over-surface:
    backgroundColor: '{colors.selected-over-surface}'
    textColor: '{colors.accent}'
  ink-on-selected-over-surface:
    backgroundColor: '{colors.selected-over-surface}'
    textColor: '{colors.ink}'
  muted-on-selected-over-surface:
    backgroundColor: '{colors.selected-over-surface}'
    textColor: '{colors.muted}'
  line-fill:
    backgroundColor: '{colors.line}'
  hairline-fill:
    backgroundColor: '{colors.hairline}'
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
  muted-on-tint-dark:
    backgroundColor: '{colors.tint-dark}'
    textColor: '{colors.muted-dark}'
  ink-on-accent-soft-dark:
    backgroundColor: '{colors.accent-soft-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-accent-soft-dark:
    backgroundColor: '{colors.accent-soft-dark}'
    textColor: '{colors.muted-dark}'
  ink-on-warn-dark:
    backgroundColor: '{colors.warn-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-warn-dark:
    backgroundColor: '{colors.warn-dark}'
    textColor: '{colors.muted-dark}'
  accent-on-warn-dark:
    backgroundColor: '{colors.warn-dark}'
    textColor: '{colors.accent-dark}'
  accent-on-tint-dark:
    backgroundColor: '{colors.tint-dark}'
    textColor: '{colors.accent-dark}'
  ink-on-tint-dark:
    backgroundColor: '{colors.tint-dark}'
    textColor: '{colors.ink-dark}'
  warn-ink-on-surface-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.warn-ink-dark}'
  warn-ink-on-canvas-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.warn-ink-dark}'
  ink-on-hover-over-canvas-dark:
    backgroundColor: '{colors.hover-over-canvas-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-hover-over-canvas-dark:
    backgroundColor: '{colors.hover-over-canvas-dark}'
    textColor: '{colors.muted-dark}'
  ink-on-hover-over-surface-dark:
    backgroundColor: '{colors.hover-over-surface-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-hover-over-surface-dark:
    backgroundColor: '{colors.hover-over-surface-dark}'
    textColor: '{colors.muted-dark}'
  ink-on-hover-over-tint-dark:
    backgroundColor: '{colors.hover-over-tint-dark}'
    textColor: '{colors.ink-dark}'
  accent-on-selected-over-canvas-dark:
    backgroundColor: '{colors.selected-over-canvas-dark}'
    textColor: '{colors.accent-dark}'
  accent-on-selected-over-surface-dark:
    backgroundColor: '{colors.selected-over-surface-dark}'
    textColor: '{colors.accent-dark}'
  ink-on-selected-over-surface-dark:
    backgroundColor: '{colors.selected-over-surface-dark}'
    textColor: '{colors.ink-dark}'
  muted-on-selected-over-surface-dark:
    backgroundColor: '{colors.selected-over-surface-dark}'
    textColor: '{colors.muted-dark}'
  line-fill-dark:
    backgroundColor: '{colors.line-dark}'
  hairline-fill-dark:
    backgroundColor: '{colors.hairline-dark}'
  warn-line-fill-dark:
    backgroundColor: '{colors.warn-line-dark}'
---

# UniGuide AI — design rules

The rules for how the interface looks, for whoever writes a screen, person or agent. The YAML block above is generated from [frontend/src/index.css](frontend/src/index.css) by `node scripts/design-md.mjs` (run from `frontend/`) and is never edited by hand; `npm run check:design` fails while it is stale or while the format's linter reports anything. The format is Google's DESIGN.md (outside the repository: the `@google/design.md` package), whose section titles the linter reads. Why the interface looks this way is [docs/decisions.md](docs/decisions.md), 2026-10-07; this file says how to apply it.

## Overview

A university lab tool that answers questions about a course and the campus, in the university's blue on greys tinted toward it, laid out and furnished like the AI products it measures itself against rather than like the university's website. Three rules hold it together:

- **The blue is for acting and for being somewhere**: a primary button, the focus ring, a link, the open conversation, the current page, the mark. The reading never wears it.
- **One family, from the headings to the answer**: Figtree, so the face does not change between a page's title, the question box and the last line of the answer; a heading is told by its weight and its size.
- **One cat**: Fumetto, the mark and the mascot, appears where a screen greets, waits, apologises or is lost, beside the words that say so, and nowhere for decoration alone.

## Colors

Every colour is a token with a job, named in `index.css` and used through its utility (`bg-surface`, `text-muted`), never as a raw value or a Tailwind palette step. The dark theme swaps the same names, so no component carries a second set of classes.

- **Grounds**: `canvas` is the page, under the grain: a fine noise in the accent's hue that never moves, at most 7 % over the light ground and 5.6 % over the dark one, painted with the ground by `bg-ground`. `surface` is a card or a field on it and carries no grain; the sidebar stands on the ground itself, one line between it and the page. `tint`, two points off `surface`, is the ground of a panel's head or foot: a card's, a dialog's, a table's head. `mark` is the quiet fill of a citation pill at rest, a count, a neutral chip and a skeleton.
- **Text**: `ink` for everything read, `muted` for what supports it (a subtitle, an excerpt, an idle row). There is no third grey.
- **Lines**: `line` separates panels, and only that; `hairline`, a step lighter, separates what is inside one panel, its rows and its foot. A card is told apart by its outline, not by a step of fill.
- **The accent**: `accent` is the university website's blue, `accent-ink` the text that sits on it, `accent-soft` the tint of a chip in the accent and of a soft button, edged by `accent-line`.
- **Interaction**, in the accent: `hover`, the accent at 6 % (9 % in the dark theme), fills whatever is under the pointer, a row, a menu item, a ghost or outlined button; `selected`, at 11 % (17 %), marks where the reader is, with a 3 px bar in the accent at its leading edge, and rings a field that has the focus. Both are the accent laid over whatever ground is behind them, translucent so the grain shows through. The sidebar's open conversation and current management page take it.
- **The warning**: `warn`, `warn-line` and `warn-ink` are the one other hue, for a failure and for confirming that something will be destroyed. Nothing else is red.

A citation pill says it can be clicked by its fill, never by colour: `mark` at rest, `ink` with canvas lettering under the pointer and while its card is open. Blue inside the prose would read as an ordinary link. Every pair of colours the interface puts together is listed in [frontend/scripts/palette.mjs](frontend/scripts/palette.mjs) and held to 4.5:1 in both themes by `npm run check:contrast`, a translucent one laid over each ground it sits on first; a new pair is added there before it ships. Contrast is measured on the bare ground: on the grain's strongest pixel muted text, the faintest, keeps 6.2:1 in light and 7.9:1 in dark. axe cannot measure text over a background image, so `frontend/e2e/a11y.spec.ts` hides the grain before it runs and fails on any contrast axe leaves unmeasured.

## Typography

One family, Figtree (`font-sans`, the page's default), self-hosted under the SIL Open Font License and followed by the system's Chinese faces:

- **Headings** at `text-title` or `text-display`, at 600 (`font-semibold`) or 700, the display size closed by a fiftieth of an em, which its token carries. A heading without its weight, or in a second family, fails `src/theme/tokens.test.ts`.
- **The answer** at `text-reading`, in a column no wider than `max-w-reading` (720 px).
- **Controls, labels and the rest** of the interface at `text-body` and `text-caption`.

Five sizes carry the interface, and a sixth needs a reason: `caption`, `body`, `reading`, `title`, `display`. Chinese is not packaged: the system draws it, PingFang, Source Han or Microsoft YaHei. Wherever text says it is Chinese, `:lang(zh)` rules in `index.css` give it its own stack, `font-sans-zh`, headings and answers included, and give reading text the looser leading `reading-zh`. That stack starts with Figtree for Latin letters and digits alone and goes straight to the Chinese faces, so quotes, the ellipsis and the dash in Chinese are drawn by the Chinese face, the quotes full width, and its Latin letters match the interface's; every family between Figtree and the generic fallback is a Chinese face that draws the quotes full width, since Segoe UI draws that punctuation narrow and so does Microsoft YaHei UI. Text in another language keeps its own stack inside the Chinese interface, and Chinese text gets the Chinese stack inside any other: the family follows `lang`, from the page's root down, and no element below the root declares one for itself. An answer therefore carries `lang` with the language it was written in, which is not always the interface's.

## Layout

Distances are named by what they are for, never by a step: `hair`, `tight`, `snug`, `gutter` and `room` for the rhythm inside and between things; `control-xs`, `control-sm` and `control` for a button's three heights (28, 32 and 40 px, a field's being the last) and `control-icon` for an icon button; `icon` and `icon-lg` for glyphs; `avatar-sm` for a person's smallest avatar, which at 32 and 40 px matches the control beside it; `avatar` and `mascot` for the cat. A component that writes `px-4` or `h-10` fails the component layer's test.

The page never scrolls sideways at 375 px. The chat column and the composer share one width; the sidebar is a column from `lg`, folded into a rail when the reader asks, and a drawer below it. Below `sm` a data table stacks each row into a card, its cells labelled with their columns, because a phone has no width for five columns.

## Elevation & Depth

Two shadows, by height: `shadow-raised` for what rests on the page (a card, an outlined button), `shadow-overlay` for what floats above it (a dialog, a menu, the drawer). Both take the palette's hue, so they read as depth rather than dirt.

Three layers, by what sits over what: `z-lifted` for a control above its row's stretched link or a sticky table head, `z-backdrop` for the scrim behind a dialog, `z-floating` for what floats on it. A numbered `z-` index does not appear outside `index.css`.

Motion is spent through six durations (`duration-instant`, `-fast`, `-base`, `-slow`, `-reveal`, `-scene`), a `--stagger` between things arriving in a row, and four curves (`ease-standard`, `-out`, `-emphasized`, `-strong`), named in `index.css` beside the reference interface each was read off; `fast` and `standard` are what every `transition-colors` takes. Beyond colour, what moves is the living cat (under Components), the entry's intro writing its caption in (`blur-in`), the entry receding into the conversation, the conversation arriving and the question box travelling to its foot (`recede`, `arrive`, `travel`), the cat beside an answer thinking, a slow pulse while the answer is being prepared, the process line's words shimmering while the search runs (`shimmer`), the caret blinking after the last word of an answer being written (`caret-after`), the sources panel arriving from the right (`slide-in-right`), a field's label floating up and its line growing, the sign-in button's spinner and its check drawn in (`draw-in`), the sign-in card shaking once when refused, the room behind the entry screens drawing itself in once (`room-draw`) and sliding with the pointer, and the cat's jump from an accepted sign-in to the entry: it crouches on the card (`crouch`), flies in an arc to its place on the entry inside a view transition (`leap`) while the card falls away (`fall`), and the entry's caption, line and question box rise into place (`rise`). Nothing moves for a reader whose system asks for reduced motion: what moves from script asks `lib/useReducedMotion.ts`, and `frontend/e2e/motion.spec.ts` checks every screen, the living cat's drawing included.

The pill (`bg-pill`) is the material of what floats in the page and takes input, the question box first: about half-white over the ground, a one-pixel inner highlight and a soft shadow, and no blur behind it, so the grain shows through it at about half its strength, as through glass laid on paper, where a card covers it.

🔜 (M4, #136) A first visit is guided once per audience, can be skipped and replayed from the account menu, and stays seen in the browser; an empty screen explains itself.

## Shapes

Four corners, by what wears them: `rounded-chip` for a short word (a code, a segment, the corner a message bubble points from), `rounded-control` for a control and a notice, `rounded-card` for a card, a window and a menu, `rounded-bubble` for a message and the composer. `rounded-full` is kept for what is round by shape: an avatar, a pill, a dot. Softer than the university website's square frames, which the interface must not imitate.

Icons come from Lucide, at `size-icon` beside text and `size-icon-lg` standing alone, and take the colour of the text beside them. One exception: the icon of an action row, a row in a list that starts something rather than leading somewhere, such as the sidebar's new-conversation row, takes the accent, so the one action among places reads as one.

## Components

The primitives live in `frontend/src/components/ui/`, in the shadcn manner (Radix underneath, variants through `cva`), each exported from one file; `/styleguide` shows every one of them in both themes side by side, and its test fails on a primitive it does not show. Screens compose primitives and do not restyle them. A link that looks like a button uses `buttonVariants`. Bare text that can be pressed, the language menu in the visitor's header or the intro's Skip, shows `hover-sketch` on hover: a one-pixel ink ring turned two degrees, as if drawn round it by hand.

Every component follows five rules (#190):

1. **Two levels.** What matters is in `ink` at its weight; what supports it is `text-caption` in `muted` on a second line: a conversation is its title and time over its source, a table cell a name over its code, a person a name over a username, a dialog its action over its object.
2. **Labels have a fill.** Data on a label is a `Chip`, a tint edged by a hairline: `accent` for the current state, a role or a source; neutral for a code, a kind or a language; `warn` for a failure. A quantity is a `Count`. `Badge` stays for a marker, a word that points at something rather than data about it.
3. **Interaction is in the accent.** What is under the pointer takes `hover`, where the reader is takes `selected` with a 3 px bar, a control in focus a 2 px ring in `accent`, and a field its accent edge and a 3 px ring of `selected`; a refused field keeps the warning's edge, its ring a tint of it. A setting that is true stays out of the accent: a chosen toggle is raised in ink. The citation pill keeps its fill (Colors).
4. **Separation is visible.** One pixel between groups; a panel's head and foot on `tint` behind a `hairline`; lists, tables and dialogs are panels with a 1 px border and `rounded-card` corners, never whitespace alone.
5. **Numbers and keys show.** Group titles and tabs carry a `Count`; menu items and a form dialog's primary button show their key on a `Kbd`, named in `aria-keyshortcuts`; a search field shows its key; what is on its way shows a `Spinner` or a `Skeleton`, both motionless under reduced motion.

The layer holds `Button` (primary, soft, outline, ghost and warn; 28, 32 and 40 px; `pending` and `shortcut`), `Kbd`, `Chip`, `Count`, `StatusDot`, `Spinner`, `Skeleton`, `Avatar` and `AvatarStack`, `Field`, `SearchField` and `FieldError`, `ToggleGroup`, `Tabs`, `Card` with `CardHeader` and `CardFooter`, `Banner`, `Empty`, `Table`, `Breadcrumb` and `Badge`, and the overlays below; each file's opening comment says how it is used.

A hint is a `Tooltip`, the inverse of the page (canvas lettering on ink), opened by a resting pointer or by keyboard focus and closed by Escape; the browser's `title` attribute is never one, and a lint rule refuses it at commit time (`frontend/biome-plugins/no-title-attribute.grit`). A component's own prop for its heading is `heading`, never `title`; an element that truly needs the attribute, such as an iframe named by it, carries a suppression with its reason. A touch screen cannot open a hint, so a hint only repeats what the visible text or the accessible name says, as the copy button's hint repeats its name.

A `HoverCard` previews where a link goes: a card's surface, opened by a pointer resting on the link or by keyboard focus, closed by Escape or by leaving. Radix keeps it out of the tab order, so it never holds anything that is not reachable elsewhere, and a touch follows the link. It may carry a head on `tint` saying what the link points at, and its actions as soft buttons under the body.

A `Dialog` is 440 px wide: a head with the action's icon in a disc, its title and the object it acts on; a body; and a foot on `tint` holding the buttons, the primary last. A dialog that is a form is one form, so Enter sends it, and its primary button shows Enter. An `AlertDialog` is drawn the same way and opens on Cancel, so it shows no Enter; its disc and its confirming button take `warn` only when something is destroyed, and its sentence names its objects as chips. A `DropdownMenu` has a head, sections with a label where they need one, 32 px items with their key at the right, rules from edge to edge, and a choice, such as the language, as a submenu showing its current value. A toast is the page's inverse, like a hint: an icon in a disc and two lines, what happened over what it happened to; a failure has the warning's disc and a way to try again.

The signed-in shell (`features/chat/ChatShell.tsx`, #191) has the shape of ChatGPT's, Claude's and Gemini's. The sidebar, `w-sidebar` wide, stands on the ground with one line between it and the page. From the top: the mark and the app's name at `text-title`, the fold button shown while the pointer or the focus is in the sidebar; a new conversation as the first row, its icon in the accent and its label at 600, its key in its hint; the search field, which filters the loaded titles in the browser and says when none matches; «Gestione», for staff, each page with a `Count`; «Fissate», counted, whenever something pinned is shown; and «Recenti», counted, both groups in the order of each conversation's last message, so pinning moves a row and reorders nothing (#192). A row is two lines: the title, in the language of its first question, with the time of its last message at its right, the hour on its own day, the word for yesterday on the next, otherwise the day and the month, in the interface's language; then, in `text-caption` and `muted`, what its last answer drew on, a book and the first course's name with «+N» for the others, a landmark and «Ateneo» for the university's pages, both, or «Nessuna fonte» when every answer was refused for want of excerpts. Under the pointer or the focus the pin and delete buttons take the time's place, the pin drawn as what it will do, and the row makes room for them on both lines; on a touch screen they are always there. While the list is on its way it shows three `Skeleton` rows, and only a list the server says is empty shows the `Empty` panel, the sleeping cat in its disc, with no button: the question box beside it is the way on.

The account is a row at the sidebar's foot: the avatar, the name and the account's widest role on a `Chip`. Its menu, as wide as the row, opens above it: a head with the same three; «Lingua», a submenu showing the language in use, each language its code on a chip and its name in itself, which sets the interface and `User.locale`; «Impostazioni…», a dialog with the theme alone and a line saying where the language is; «Aiuto e scorciatoie», a dialog listing every key; the Django admin for the superuser; and signing out.

Folded, the sidebar is a rail of icons, `w-rail` wide and remembered in the browser: the mark, which unfolds it; a new conversation; the search, which unfolds the sidebar and puts the focus in its field; one icon per Gestione page, the current one in `selected`; and the avatar, whose menu opens at its right. Each icon's hint repeats its name and gives its key. Below `lg` the same panel is a drawer from the left, its close button where the fold button was, and its menu opens the languages in place. Four keys work from any signed-in page: Ctrl ⇧ O starts a conversation; Ctrl K puts the focus in the search, unfolding the sidebar or opening the drawer first; Ctrl , opens the settings; `?`, outside a field, opens the list of keys. On Apple's keyboards the key is ⌘ rather than Ctrl, which stays the text field's own there. The keys wait while another dialog is open, wherever the focus is, so nothing acts behind it. Escape closes a submenu, then its menu, then the drawer, and the focus goes back to what opened each.

An answer is drawn in one order (`features/chat/TurnView.tsx`), after ChatGPT and Open WebUI, with Perplexity's process line (read 11 October 2026):

- **The process line** (`ProcessLine.tsx`), one line above the answer at `text-body` in `muted`: a search icon and the seconds counting, its words shimmering, while the search runs; then a check, the server's seconds and a chevron, folded, opening onto where it searched, how many excerpts it read and each source once. The router's reason is never shown.
- **The answer**, in Figtree at `text-reading`, its citations as pills: `rounded-full`, `text-caption`, the source's short name (the host without `www.`, or the slide's page), a run of them as «name +N». A pill links to its source, a web page at its passage and a slide at its page, and previews every source of its run in a `HoverCard`; its accessible name starts with what it shows.
- **Under a settled answer**, a ghost icon button that copies the answer without its markers, and the sources button, an outlined pill with up to three stacked source marks, which opens the sources panel: a `Sheet` from the right, full width below `sm`, the cited sources first and the rest after them under a heading of their own, never marked as unused, and every source in one list when the answer cited none. Closing it gives focus back to the button.

A password is typed into `components/PasswordField.tsx`, with an eye inside the field, after Edge's own reveal and Material 3's secure text field: a toggle button whose name, "Show password", never changes, its state in `aria-pressed`, which a screen reader announces. Pressing it with a pointer leaves the focus in the field. The letters are hidden again when the form is sent and when the page returns from the back-forward cache, and Edge's own eye in the field is hidden, so there is one way to show them. While the field has the focus and Caps Lock is on, a neutral chip under it says so, as the macOS and Windows sign-in fields do.

The sign-in and registration forms sit on a card with no border (`routes/AuthLayout.tsx`): `surface`, `rounded-bubble` and `shadow-overlay`, the living cat's head sitting on its top edge. Their fields are `components/LineField.tsx`, after Material 3's filled text field: an underline in `muted`, which is the field's only edge, the label inside the field floating up to four fifths of its size on focus, once filled or once a password manager has filled it, and an accent line growing from the left while the focus is in the field, `warn-ink` while the field is refused. The submit button is a full pill: an arrow slides in under the pointer or the focus, a spinner turns while the server decides and a check is drawn in when it accepts, after Stripe Checkout's pay button, and it is `aria-disabled` from the send until the page leaves. What the server refused is a line in `warn-ink` after an icon (`FieldError`, the same as a form field's in a page), under its field and tied to it by `aria-describedby`; a refused sign-in shakes the card once, after the macOS sign-in window, and empties the password. The registration's password carries a hint of its minimum length.

Behind the sign-in, the registration and the entry stands a room drawn in the cat's line (`features/entry/Room.tsx`), after the Firewatch website's layered scene: a bookshelf with a plant and a paper plane, a window with clouds, a desk with a lamp, a mug and books, in `accent` at `--room-strength` (0.42 light, 0.5 dark), with lines that keep their width at any size. It stands in two wings anchored to the lower corners, each at most half of what the card or the question box leaves free, so no line runs under them or under any text; on a phone the wings stand in a strip under the form. It draws itself in once per page load, after a visitor's first-visit intro when one plays, and then moves only with the pointer, three depths of at most 10 px, never by itself, so it needs no pause control; under reduced motion it is whole and motionless, and a device that cannot hover gets no parallax. It leaves with the entry, fading as the entry recedes, and the conversation keeps the grain alone.

Fumetto is drawn by `components/Mascot.tsx` from the one drawing in `frontend/src/brand/fumetto.ts`, always decorative (`aria-hidden`), in the accent's line:

| Pose | Where |
| ---- | ----- |
| `avatar` | Beside every answer, at `size-avatar`; the mark (`MascotMark`, the head on its tile) beside the app's name in the sidebar |
| `welcome` | The brand files; the living cat smiles with its eyes and wears its stars |
| `thinking` | Beside an answer until its first word, pulsing |
| `error` | Beside an answer that failed, and on the panel of a page that broke |
| `notFound` | An address the application does not have, and a staff page whose object cannot be read |
| `sleep` | The sidebar's list of conversations before the first one, in a disc of `accent-soft` |

Where a screen greets, the entry and the sign-in and registration screens, Fumetto is alive: `components/LivingMascot.tsx`, at `w-entry-cat` (`w-entry-cat-sm` on a phone), its behaviour in `components/mascotLife.ts`. Awake, it blinks, flicks an ear, sways the bubble's tip and breathes, and its eyes go to the pointer, to the caret of the focused field, or to the question box when nobody moves. It smiles while the pointer is on an element marked `data-mascot-cheer`, the send button, unless something else holds its face, and when it hops as a question goes. After ten idle seconds it yawns and sleeps, eyes closed and a "z" rising, until a pointer, key or wheel wakes it with a double blink. On the sign-in and registration forms it answers the form, after Darin Senneff's Yeti and Telegram Web's monkey: while the password field or its eye has the focus (`data-mascot-away`) it shuts its eyes and turns its head aside, and one eye opens while the letters are shown; it watches the button while the form is sent (`data-mascot-busy`); a refusal makes it shake its head under drooping lids, with a flat mouth; a password manager's fill, which fires no input event, makes it glance at each filled field, caught by the `autofill` animation's start; an accepted form makes it smile, and it lands on the entry smiling. With reduced motion it does not move, and that setting is the only stop: nothing on the page stops it, which falls short of the stop control WCAG 2.2.2 asks of motion that lasts beyond five seconds. The face beside an answer is the motionless `Mascot`. A visitor's first visit opens on an intro, once and skippable: the cat drawn in one stroke, then the caption written in six languages before the interface's own, its name the settled caption throughout.

A pose appears only where words beside it say what it means. Colours, sizes, clear space and what the mark may never be combined with are in [frontend/brand/README.md](frontend/brand/README.md).

A screen with nothing of its own to show is one centred panel on `surface`, `components/StatusPanel.tsx`: the pose in a disc of `accent-soft`, of `warn` when something broke, the cat keeping its blue; a chip with the code where there is one; a heading, one sentence, and a primary and a secondary way on. An address that names no page shows it with its 404 and the way to the start; a page that broke while drawing shows it with a reload first and the start second, its words a live region, inside the frame when only the page broke and over the window when the frame did, where the error's technical details are folded under the ways on. No screen of this kind is drawn another way, and none is blank.

## Do's and Don'ts

- Do spend colour, distance, corners, shadows and layers through their tokens; don't write a raw value or a Tailwind step where a token exists.
- Do keep an answer's text in `ink`; don't colour anything inside the reading blue unless it is a link.
- Do put an answer's sources after it, behind its pills and its sources button; don't put a strip of sources, a route or a reason above it.
- Do give `selected` to where the reader is; don't give the accent to a setting that is merely true, such as the chosen language or theme.
- Do keep the warning hue for failure and destruction; don't use it for emphasis.
- Do add a colour pair to `palette.mjs` before a screen composes it.
- Do show the ground with `bg-ground`; don't paint `bg-canvas`, which leaves a flat patch in the grain.
- Do let a table stack on a phone; don't let a page scroll sideways.
- Do let a control act and say what will follow, as deleting the conversation being answered says that its answer stops; don't disable a control to say why it cannot act, and where it truly cannot, say why beside it. A control is disabled only while its own request is on its way, so that it is not sent twice.
- Don't use the university's mark, its lettering or its page furniture (a blue band, uppercase navigation, square frames): only its blue.
- Don't move anything a reader with reduced motion would see move.
