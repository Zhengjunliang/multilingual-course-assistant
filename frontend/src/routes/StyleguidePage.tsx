/**
 * Every component in the layer, in both themes, on one page.
 *
 * It sits outside `RequireSession` on purpose. The catalogue calls no endpoint,
 * reads no account and renders no one's data — putting it behind a session
 * would protect nothing and would cost its test a fake account to log in with.
 * That it is reachable in production is accepted and stated here rather than
 * discovered later.
 *
 * Deliberately not translated. The three catalogues exist for the people who
 * use the product; this page is for the person building it, and adding eight
 * component names to `en`, `it` and `zh-hans` would be three files of churn for
 * a page no reader opens.
 *
 * The two themes are two nested `data-theme` panels rather than a toggle. A
 * toggle shows one theme at a time, which is exactly how a component ends up
 * correct in one and wrong in the other — the whole reason index.css keeps the
 * theme in variables and nowhere else.
 */

import { LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { Sheet } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Suggestion, Suggestions } from "@/components/ui/suggestion";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// Written out whole: Tailwind finds a class by reading the source, so a class
// assembled from `rounded-${corner}` would never be generated.
const CORNERS = {
  chip: "rounded-chip",
  control: "rounded-control",
  card: "rounded-card",
  bubble: "rounded-bubble",
} as const;

function Specimen({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-tight border-line border-t pt-snug first:border-t-0 first:pt-0">
      <h3 className="font-mono font-medium text-caption text-ink">{name}</h3>
      <p className="text-caption text-muted">{note}</p>
      {children !== undefined && (
        <div className="flex flex-wrap items-end gap-tight">{children}</div>
      )}
    </section>
  );
}

function Panel({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      data-theme={theme}
      className="flex min-w-0 flex-1 flex-col gap-room rounded-card border border-line bg-canvas p-gutter"
    >
      <h2 className="font-semibold text-ink text-title">{theme}</h2>

      <Specimen
        name="Button"
        note="Four variants, three sizes. The default fill is the accent, the university's blue; destructive takes the warning's hue, and only confirms destroying something."
      >
        <Button>default</Button>
        <Button variant="outline">outline</Button>
        <Button variant="ghost">ghost</Button>
        <Button variant="destructive">destructive</Button>
        <Button size="sm">sm</Button>
        <Button size="icon" aria-label="icon">
          ●
        </Button>
        <Button disabled>disabled</Button>
      </Specimen>

      <Specimen
        name="Type"
        note="Fraunces for headings and the answer, at the reading size; Figtree for every control. Chinese falls through to the system's faces."
      >
        <div className="flex max-w-prose flex-col gap-tight">
          <p className="font-semibold font-serif text-ink text-title">
            Il passo lungo il gradiente
          </p>
          <p lang="en" className="font-serif text-ink text-reading">
            The learning rate sets the size of each step along the negative gradient; a value too
            large makes the loss <em>oscillate</em>.
          </p>
          <p lang="it" className="font-serif text-ink text-reading">
            Il tasso di apprendimento fissa l'ampiezza di ogni passo; un valore troppo alto fa{" "}
            <em>oscillare</em> la perdita.
          </p>
          <p lang="zh-hans" className="font-serif text-ink text-reading">
            学习率决定了沿负梯度方向每一步的大小；学习率过大会导致损失震荡。
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

      <Specimen name="Card" note="Surface, hairline border, raised a step off the page.">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>CardTitle</CardTitle>
            <p className="text-caption text-muted">CardHeader holds the title and its caption.</p>
          </CardHeader>
          <CardContent>CardContent carries the body at eighty percent ink.</CardContent>
        </Card>
      </Specimen>

      <Specimen name="Input" note="One control height, shared with the default button.">
        <Input placeholder="Input" />
      </Specimen>

      <Specimen name="Textarea" note="Starts at the field height and grows downward only.">
        <Textarea placeholder="Textarea" />
      </Specimen>

      <Specimen
        name="LocaleSwitch"
        note="Rendered twice on screen — header and login frame — and written once. The language in use wears ink and a quiet fill, never the accent: the accent is for what a reader is about to do, not for a setting already true."
      >
        <LocaleSwitch locales={["it", "en", "zh-hans"]} value="it" onChange={() => {}} />
      </Specimen>

      <Specimen
        name="Suggestions"
        note="A row that scrolls sideways rather than wrapping, so the composer never gets pushed down a line."
      >
        <Suggestions>
          <Suggestion suggestion="Quando scadono le tasse?" />
          <Suggestion suggestion="Come funziona l'Erasmus?" />
          <Suggestion suggestion="Suggestion" />
        </Suggestions>
      </Specimen>

      <Specimen name="Avatar" note="A letter in a circle. There is no picture of anyone to load.">
        <Avatar name="junliang" />
        <Avatar name="Émile" />
        <Avatar name="" />
      </Specimen>

      <Specimen
        name="DropdownMenu"
        note="Only the trigger is here: the menu itself opens in a portal at the end of the document, so it follows the page theme rather than this panel."
      >
        <DropdownMenu
          ariaLabel="Account"
          trigger={<Avatar name="junliang" />}
          label="junliang"
          caption="Studente"
          entries={[
            { key: "account", icon: UserRound, label: "Account", onSelect: () => {} },
            { key: "logout", icon: LogOut, label: "Esci", onSelect: () => {} },
          ]}
        />
      </Specimen>

      <Specimen
        name="Badge"
        note="A word for a state, in the accent on --accent-soft, the pair that marks the current one: text, so it reads the same without colour."
      >
        <Badge>Corrente</Badge>
      </Specimen>

      <Specimen
        name="Table"
        note="Native table markup named by its caption: TableCaption, TableHeader, TableBody, TableRow, TableHead, TableCell. It scrolls inside its own frame on a narrow screen; a row under the pointer wears --mark."
      >
        <Table>
          <TableCaption>Edizioni</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Corso</TableHead>
              <TableHead>Anno</TableHead>
              <TableHead>Stato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>B028451 Progettazione e Produzione Multimediale</TableCell>
              <TableCell>2025-2026</TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell>B028451 Progettazione e Produzione Multimediale</TableCell>
              <TableCell>2024-2025</TableCell>
              <TableCell>
                <Badge>Corrente</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Specimen>

      <Specimen
        name="Breadcrumb"
        note="The pages above this one, each a link, and this one marked as the current page."
      >
        <Breadcrumb
          label="Percorso"
          crumbs={[
            { label: "Corsi di laurea", to: "/staff/programmes" },
            { label: "B047 · INGEGNERIA INFORMATICA" },
          ]}
        />
      </Specimen>

      <Specimen
        name="Toaster"
        note="Where a finished action says so, in the corner, read out politely and gone after a few seconds; the button raises one."
      >
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            toast("Docente assegnato", { description: "mrossi · B028451 · 2025-2026" })
          }
        >
          Mostra un avviso
        </Button>
        <Toaster />
      </Specimen>

      <Specimen
        name="Sheet"
        note="A drawer over the whole page, so it cannot be shown inside this panel. It is open in the specimen below, outside the two themes."
      />

      <Specimen
        name="Dialog"
        note="A window in the middle of the page. Portalled like the drawer, and shown below for the same reason."
      />

      <Specimen
        name="AlertDialog"
        note="A question before an action that destroys or replaces something. Focus opens on Cancel; it closes only once the action is done. Portalled, and shown below."
      />

      <Specimen
        name="Accent"
        note="The university's blue, #004C7F, a lighter step of it on dark: spent on what a reader can do. --accent-soft marks where they are; --mark is the quiet fill that says a thing can be clicked; --warn is the one other hue."
      >
        <span className="rounded-chip bg-accent px-snug py-hair text-accent-ink text-caption">
          --accent
        </span>
        <span className="rounded-chip bg-accent-soft px-snug py-hair text-accent text-caption">
          --accent-soft
        </span>
        <span className="rounded-chip bg-mark px-snug py-hair text-caption text-ink">--mark</span>
        <span className="rounded-chip border border-warn-line bg-warn px-snug py-hair text-caption text-warn-ink">
          --warn
        </span>
      </Specimen>
    </div>
  );
}

export default function StyleguidePage() {
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);

  return (
    <div className="min-h-full bg-canvas p-gutter">
      <div className="mx-auto flex max-w-6xl flex-col gap-room">
        <header className="flex flex-col gap-hair">
          <h1 className="font-semibold font-serif text-display text-ink">Component catalogue</h1>
          <p className="text-body text-muted">
            Every component of the layer, side by side in both themes. A primitive added and left
            out of this page fails its own test.
          </p>
        </header>

        <div className="flex flex-col gap-gutter lg:flex-row">
          <Panel theme="light" />
          <Panel theme="dark" />
        </div>

        <div className="flex flex-col gap-tight">
          <Button className="self-start" onClick={() => setDrawer(true)}>
            Open the Sheet
          </Button>
          <Sheet open={drawer} onOpenChange={setDrawer} title="Sheet specimen">
            <div className="flex flex-col gap-tight p-gutter">
              <p className="text-body text-ink">
                The drawer renders in a portal at the end of the document, which is why it follows
                the page theme rather than either panel above.
              </p>
              <Button variant="outline" onClick={() => setDrawer(false)}>
                Close
              </Button>
            </div>
          </Sheet>

          <Button className="self-start" onClick={() => setDialog(true)}>
            Open the Dialog
          </Button>
          <Dialog
            open={dialog}
            onOpenChange={setDialog}
            title="Dialog specimen"
            description="A centred window, not a drawer."
            closeLabel="Close"
          >
            <p className="text-body text-ink">
              Wide enough for a form on a phone and no wider on a desk, with its own scroll so a
              long body cannot push the close button off a short screen.
            </p>
          </Dialog>

          <Button className="self-start" onClick={() => setAlert(true)}>
            Open the AlertDialog
          </Button>
          <AlertDialog
            open={alert}
            onOpenChange={setAlert}
            title="AlertDialog specimen"
            description="Removing mrossi from B028451 2025-2026 cannot be undone from here."
            cancelLabel="Cancel"
            confirmLabel="Remove"
            onConfirm={async () => true}
            destructive
          />
        </div>
      </div>
    </div>
  );
}
