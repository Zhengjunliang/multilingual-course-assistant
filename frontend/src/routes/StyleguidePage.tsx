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
 * theme in variables and nowhere else. Each panel holds the specimens of
 * `routes/styleguide/`, one file per group.
 */

import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Basics } from "./styleguide/basics";
import { Fields } from "./styleguide/fields";
import { Overlays } from "./styleguide/overlays";
import type { Theme } from "./styleguide/Specimen";
import { Status } from "./styleguide/status";
import { Surfaces } from "./styleguide/surfaces";

function Panel({ theme }: { theme: Theme }) {
  return (
    <div
      data-theme={theme}
      className="flex min-w-0 flex-1 flex-col gap-room rounded-card border border-line bg-ground p-gutter"
    >
      <h2 className="font-semibold text-ink text-title">{theme}</h2>
      <Basics />
      <Fields theme={theme} />
      <Surfaces />
      <Overlays />
      <Status />
    </div>
  );
}

export default function StyleguidePage() {
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);

  return (
    <div className="min-h-full bg-ground p-gutter">
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
          <Sheet
            open={drawer}
            onOpenChange={setDrawer}
            heading="Fonti"
            closeLabel="Chiudi le fonti"
            count={5}
            side="right"
          >
            <div className="flex flex-col gap-tight p-gutter">
              <p className="text-body text-ink">
                The drawer renders in a portal at the end of the document, which is why it follows
                the page theme rather than either panel above.
              </p>
            </div>
          </Sheet>

          <Button className="self-start" onClick={() => setDialog(true)}>
            Open the Dialog
          </Button>
          <Dialog
            open={dialog}
            onOpenChange={setDialog}
            heading="Assegna docente"
            description="Basi di dati · edizione 2026/27"
            icon={UserPlus}
            closeLabel="Chiudi"
            onSubmit={(event) => {
              event.preventDefault();
              setDialog(false);
            }}
            footer={
              <>
                <Button type="button" variant="outline" onClick={() => setDialog(false)}>
                  Annulla
                </Button>
                <Button type="submit" shortcut={{ keys: "Enter", label: "Invio" }}>
                  Assegna
                </Button>
              </>
            }
          >
            <Field
              id="styleguide-dialog-username"
              label="Nome utente"
              placeholder="es. luca.verdi"
              hint="Il nome con cui la persona accede; l'account deve già esistere."
            />
          </Dialog>

          <Button className="self-start" onClick={() => setAlert(true)}>
            Open the AlertDialog
          </Button>
          <AlertDialog
            open={alert}
            onOpenChange={setAlert}
            heading="Revocare il ruolo?"
            description={
              <>
                <Chip>luca.verdi</Chip> non sarà più docente di <Chip>Basi di dati</Chip>, edizione{" "}
                <Chip tone="accent">2026/27</Chip>.
              </>
            }
            icon={Trash2}
            cancelLabel="Annulla"
            confirmLabel="Revoca"
            onConfirm={async () => true}
            destructive
          />
        </div>
      </div>
    </div>
  );
}
