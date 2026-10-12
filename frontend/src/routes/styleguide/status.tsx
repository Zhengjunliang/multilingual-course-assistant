/**
 * The catalogue's status screens: what a page shows when it has nothing of
 * its own to show.
 */

import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusPanel } from "@/components/StatusPanel";
import { buttonVariants } from "@/components/ui/button";
import { Specimen } from "./Specimen";

export function Status() {
  return (
    <Specimen
      name="StatusPanel"
      note="One panel for every screen with nothing of its own: the cat in the pose for it, a heading, a sentence and the ways on."
    >
      <StatusPanel
        pose="notFound"
        heading="Pagina non trovata"
        body="A questo indirizzo non c'è nessuna pagina: il link potrebbe essere sbagliato o non più valido."
      >
        <Link to="/styleguide" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden className="size-icon" />
          Torna all'inizio
        </Link>
      </StatusPanel>
    </Specimen>
  );
}
