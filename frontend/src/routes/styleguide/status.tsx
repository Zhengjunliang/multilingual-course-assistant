/**
 * The catalogue's status screens: what a page shows when it has nothing of
 * its own to show, and what the outermost crash screen draws.
 */

import { ArrowLeft, BookOpen, Lock, RotateCw, SquarePen } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusPanel } from "@/components/StatusPanel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Specimen } from "./Specimen";

export function Status() {
  return (
    <>
      <Specimen
        name="StatusPanel"
        note="One centred panel for every screen with nothing of its own: the cat in a tinted disc, a code chip where there is one, a heading, a sentence and a primary and a secondary way on."
      >
        <StatusPanel
          pose="notFound"
          code="404"
          heading="Pagina non trovata"
          body="A questo indirizzo non c'è nessuna pagina: il link potrebbe essere sbagliato o non più valido."
        >
          <Link to="/styleguide" className={buttonVariants()}>
            <ArrowLeft aria-hidden className="size-icon" />
            Torna all'inizio
          </Link>
          <Link to="/styleguide" className={buttonVariants({ variant: "ghost" })}>
            <SquarePen aria-hidden className="size-icon" />
            Nuova conversazione
          </Link>
        </StatusPanel>
      </Specimen>

      <Specimen
        name="Refusal"
        note="The same panel for a staff page whose object cannot be read: a lock in the disc rather than the cat, the page being out of reach rather than lost, its code, and the reader's own start first."
      >
        <StatusPanel
          icon={Lock}
          code="404"
          heading="Non trovato"
          body="Questa pagina non esiste o non è visibile al tuo account." // spellchecker:disable-line
        >
          <Link to="/styleguide" className={buttonVariants()}>
            <BookOpen aria-hidden className="size-icon" />
            Torna ai miei insegnamenti
          </Link>
          <Link to="/styleguide" className={buttonVariants({ variant: "ghost" })}>
            <SquarePen aria-hidden className="size-icon" />
            Nuova conversazione
          </Link>
        </StatusPanel>
      </Specimen>

      <Specimen
        name="AppCrash"
        note="The panel when a page broke: the warning's disc, a reload first and the start second, and the error's technical details folded under them, from the error the boundary holds."
      >
        <StatusPanel
          pose="error"
          tone="warn"
          heading="Questa pagina si è bloccata"
          body="Qualcosa è andato storto mentre la pagina si apriva. Ricaricala."
          details={{
            label: "Dettagli tecnici",
            text: "TypeError: Cannot read properties of undefined (reading 'code')\n    at CoursePage (CoursePage.tsx)",
          }}
        >
          <Button type="button">
            <RotateCw aria-hidden className="size-icon" />
            Ricarica la pagina
          </Button>
          <Link to="/styleguide" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden className="size-icon" />
            Torna all'inizio
          </Link>
        </StatusPanel>
      </Specimen>
    </>
  );
}
