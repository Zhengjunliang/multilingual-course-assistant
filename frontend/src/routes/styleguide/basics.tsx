/**
 * The catalogue's first group: the type, the shapes and the colours, the cat,
 * and the small parts every screen is built from.
 */

import { Copy, Plus, SquarePen, Trash2, UserRound } from "lucide-react";
import { Link } from "react-router-dom";

import { LivingMascot } from "@/components/LivingMascot";
import { Mascot, MascotMark } from "@/components/Mascot";
import { Avatar } from "@/components/ui/avatar";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { Specimen } from "./Specimen";

// Written out whole: Tailwind finds a class by reading the source, so a class
// assembled from `rounded-${corner}` would never be generated.
const CORNERS = {
  chip: "rounded-chip",
  control: "rounded-control",
  card: "rounded-card",
  bubble: "rounded-bubble",
} as const;

export function Basics() {
  return (
    <>
      <Specimen
        name="Type"
        note="Figtree throughout: headings at 600, the display size closed by a fiftieth of an em; the answer at the reading size, its emphasis a true italic; every control. Chinese is set in the system's Chinese faces, its punctuation full width, with Figtree for its Latin letters; text in another language keeps its own quotes, whichever language the page is in."
      >
        <div className="flex max-w-prose flex-col gap-tight">
          <p className="font-semibold text-display text-ink">Corsi di laurea</p>
          <p className="font-semibold text-ink text-title">Il passo lungo il gradiente</p>
          <p lang="en" className="text-ink text-reading">
            The learning rate sets the size of each step along the negative gradient; a value too
            large makes the loss <em>oscillate</em>.
          </p>
          <p lang="it" className="text-ink text-reading">
            Il tasso di apprendimento fissa l'ampiezza di ogni passo; un valore troppo alto fa{" "}
            <em>oscillare</em> la perdita.
          </p>
          <p lang="zh-hans" className="text-ink text-reading">
            学习率决定了沿负梯度方向每一步的大小；学习率过大会导致损失震荡。
          </p>
          <p lang="zh-hans" className="text-body text-ink">
            课件里说“学习率不宜过大”……否则——损失会震荡。原文是{" "}
            <span lang="it">“il tasso non deve essere troppo alto”</span>。
          </p>
          <p lang="en" className="text-body text-ink">
            The slides say “keep the rate small”… or else — the loss oscillates.
          </p>
        </div>
      </Specimen>

      <Specimen
        name="Shape"
        note="Four corners by what wears them — chip, control, card, bubble — and two heights: raised on the page, overlay above it."
      >
        {(["chip", "control", "card", "bubble"] as const).map((corner) => (
          <span
            key={corner}
            className={`${CORNERS[corner]} flex size-field items-end border border-line bg-surface p-hair font-mono text-caption text-muted`}
          >
            {corner}
          </span>
        ))}
        <span className="flex size-field items-end rounded-card bg-surface p-hair font-mono text-caption text-muted shadow-raised">
          raised
        </span>
        <span className="flex size-field items-end rounded-card bg-surface p-hair font-mono text-caption text-muted shadow-overlay">
          overlay
        </span>
      </Specimen>

      <Specimen
        name="Accent"
        note="The university's blue, #004C7F, a lighter step of it on dark: spent on what a reader can do and where they are. --hover and --selected are the accent at 6 and 11 %, --accent-soft the tint of a chip or a soft button; --mark is the quiet fill of a pill or a count; --warn is the one other hue."
      >
        <span className="rounded-chip bg-accent px-snug py-hair text-accent-ink text-caption">
          --accent
        </span>
        <span className="rounded-chip bg-hover px-snug py-hair text-caption text-ink">--hover</span>
        <span className="rounded-chip bg-selected px-snug py-hair text-accent text-caption">
          --selected
        </span>
        <span className="rounded-chip border border-accent-line bg-accent-soft px-snug py-hair text-accent text-caption">
          --accent-soft
        </span>
        <span className="rounded-chip bg-mark px-snug py-hair text-caption text-ink">--mark</span>
        <span className="rounded-chip border border-hairline bg-tint px-snug py-hair text-caption text-ink">
          --tint
        </span>
        <span className="rounded-chip border border-warn-line bg-warn px-snug py-hair text-caption text-warn-ink">
          --warn
        </span>
      </Specimen>

      <Specimen
        name="Mascot"
        note="Fumetto's five poses in the accent, and MascotMark, the tile beside the app's name. Decorative: words beside it always say the same."
      >
        <MascotMark className="size-avatar" />
        {(["avatar", "welcome", "thinking", "error", "notFound"] as const).map((pose) => (
          <Mascot key={pose} pose={pose} className="size-mascot" />
        ))}
      </Specimen>

      <Specimen
        name="LivingMascot"
        note="Fumetto alive, where a screen greets: it blinks, flicks an ear, sways its tail, follows the pointer and falls asleep after ten idle seconds. With reduced motion it stands still."
      >
        <LivingMascot className="w-mascot" />
      </Specimen>

      <Specimen
        name="Button"
        note="Five variants: primary, the accent filled, for the one thing a screen asks; soft, its tint; outline; ghost; warn, the warning's tint, only to confirm destroying something. Sizes sm 28, md 32 (the default), lg 40, and two squares for an icon. Pending: a spinner and the verb in progress, off until its request ends. A shortcut shows its key."
      >
        <Button>
          <Plus aria-hidden className="size-icon" />
          Assegna docente
        </Button>
        <Button pending>Assegnazione…</Button>
        <Button variant="soft">Imposta come corrente</Button>
        <Button variant="outline">Annulla</Button>
        <Button variant="ghost">
          <Copy aria-hidden className="size-icon" />
          Copia la risposta
        </Button>
        <Button variant="warn">
          <Trash2 aria-hidden className="size-icon" />
          Revoca
        </Button>
        <Button size="sm">sm 28</Button>
        <Button>md 32</Button>
        <Button size="lg">lg 40</Button>
        <Button shortcut={{ keys: "Enter", label: "Invio" }}>Assegna</Button>
        {/* A lucide icon, as every icon button in the interface holds: a
            character such as "●" is a glyph axe takes for an icon font and
            leaves its contrast unmeasured. */}
        <Button size="icon" variant="ghost" aria-label="icon">
          <UserRound aria-hidden className="size-icon-lg" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="icon-sm">
          <UserRound aria-hidden className="size-icon" />
        </Button>
        <Button variant="outline" disabled>
          disabled
        </Button>
      </Specimen>

      <Specimen
        name="buttonVariants"
        note="The button's classes on a link, for an action that goes somewhere: the way back from a page that is not there."
      >
        <Link to="/styleguide" className={buttonVariants({ variant: "outline" })}>
          outline link
        </Link>
      </Specimen>

      <Specimen
        name="Spinner"
        note="A ring that turns beside words saying what is on its way; it stands still under reduced motion."
      >
        <span className="flex items-center gap-tight text-body text-muted">
          <Spinner />
          Caricamento…
        </span>
      </Specimen>

      <Specimen
        name="Kbd"
        note="A key on a cap with a 2 px bottom edge, hidden from screen readers: the control it labels names it in aria-keyshortcuts. Inherit draws it in the lettering around it."
      >
        <Kbd>Ctrl K</Kbd>
        <Kbd>Ctrl ⇧ O</Kbd>
        <Kbd>/</Kbd>
      </Specimen>

      <Specimen
        name="Chip"
        note="Data in a tint with a hairline: accent for the current state, a role or a source; neutral for a code, a kind or a language; warn for a failure. sm for a language code."
      >
        <Chip tone="accent">Corrente</Chip>
        <Chip tone="accent">Segreteria didattica</Chip>
        <Chip>
          <span className="font-mono">B024325</span>
        </Chip>
        <Chip>L-8</Chip>
        <Chip tone="warn">Non riuscita</Chip>
        <Chip size="sm">IT</Chip>
        <Chip size="sm">EN</Chip>
        <Chip size="sm">ZH</Chip>
      </Specimen>

      <Specimen
        name="Count"
        note="How many, in a round pill beside a group's title, a tab or a filter; in the accent for where the reader is."
      >
        <Count value={27} />
        <Count value={3} tone="accent" />
      </Specimen>

      <Specimen
        name="StatusDot"
        note="A state in words after a dot: filled in the accent when it holds, a ring when it does not."
      >
        <StatusDot on>Corrente</StatusDot>
        <StatusDot on={false}>Non corrente</StatusDot>
      </Specimen>

      <Specimen
        name="Avatar"
        note="A letter in a circle, there being no picture of anyone: accent or neutral, 24, 32 or 40 px."
      >
        <Avatar name="Laura" size="sm" />
        <Avatar name="Laura" />
        <Avatar name="Laura" size="lg" />
        <Avatar name="Giulia" tone="neutral" />
        <Avatar name="Émile" />
        <Avatar name="" />
      </Specimen>

      <Specimen
        name="AvatarStack"
        note="A few people overlapping, each cut out by a ring of the surface, the rest as +N; the names are written beside it."
      >
        <AvatarStack names={["lconti", "pneri", "msani", "gferri"]} />
      </Specimen>

      <Specimen
        name="Badge"
        note="A marker: a word that points at something, in the accent on --accent-soft. Data is a Chip."
      >
        <Badge>tu</Badge>
      </Specimen>

      <Specimen
        name="Tooltip"
        note="Opens for a pointer that rests and for keyboard focus, closes on Escape; ink with canvas lettering and an arrow, its key at the right. It opens in a portal, so it follows the page theme, and only repeats what the name or the visible text already says."
      >
        <Tooltip
          content="Nuova conversazione"
          shortcut={{ keys: "Control+Shift+O", label: "Ctrl ⇧ O" }}
        >
          <Button type="button" variant="ghost" size="icon" aria-label="Nuova conversazione">
            <SquarePen aria-hidden className="size-icon" />
          </Button>
        </Tooltip>
        <Tooltip content="Copia la risposta">
          <Button type="button" variant="ghost" size="icon" aria-label="Copia la risposta">
            <Copy aria-hidden className="size-icon" />
          </Button>
        </Tooltip>
      </Specimen>
    </>
  );
}
