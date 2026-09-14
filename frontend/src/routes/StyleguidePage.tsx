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

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Suggestion, Suggestions } from "@/components/ui/suggestion";
import { Textarea } from "@/components/ui/textarea";

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
      <h3 className="font-mono text-accent-text text-caption">{name}</h3>
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
      className="flex min-w-0 flex-1 flex-col gap-room rounded-lg border border-line bg-canvas p-gutter"
    >
      <h2 className="font-semibold text-ink text-title">{theme}</h2>

      <Specimen name="Button" note="Three variants, three sizes. The default fill is the accent.">
        <Button>default</Button>
        <Button variant="outline">outline</Button>
        <Button variant="ghost">ghost</Button>
        <Button size="sm">sm</Button>
        <Button size="icon" aria-label="icon">
          ●
        </Button>
        <Button disabled>disabled</Button>
      </Specimen>

      <Specimen name="Card" note="Surface, hairline border, no shadow of its own beyond the lift.">
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
        name="Suggestions"
        note="A row that scrolls sideways rather than wrapping, so the composer never gets pushed down a line."
      >
        <Suggestions>
          <Suggestion suggestion="Quando scadono le tasse?" />
          <Suggestion suggestion="Come funziona l'Erasmus?" />
          <Suggestion suggestion="Suggestion" />
        </Suggestions>
      </Specimen>

      <Specimen
        name="Sheet"
        note="A drawer over the whole page, so it cannot be shown inside this panel. It is open in the specimen below, outside the two themes."
      />

      <Specimen
        name="Accent"
        note="The one colour: surface, ink on it, and the same accent as text."
      >
        <span className="rounded-md bg-accent px-snug py-hair text-accent-ink text-caption">
          --accent
        </span>
        <span className="text-accent-text text-caption">--accent-text</span>
        <span className="rounded-md bg-mark px-snug py-hair text-caption text-mark-ink">
          --mark
        </span>
        <span className="rounded-md border border-warn-line bg-warn px-snug py-hair text-caption text-warn-ink">
          --warn
        </span>
      </Specimen>
    </div>
  );
}

export default function StyleguidePage() {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-full bg-canvas p-gutter">
      <div className="mx-auto flex max-w-6xl flex-col gap-room">
        <header className="flex flex-col gap-hair">
          <h1 className="font-semibold text-display text-ink">Component catalogue</h1>
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
        </div>
      </div>
    </div>
  );
}
