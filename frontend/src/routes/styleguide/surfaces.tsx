/**
 * The catalogue's surfaces: what holds a page's content, a card, a table, the
 * path to where the reader is.
 */

import { ArrowRight, BookOpen, GraduationCap, Info, Lock, MessageSquare } from "lucide-react";
import { useState } from "react";

import { AvatarStack } from "@/components/ui/avatar-stack";
import { Banner } from "@/components/ui/banner";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { Empty } from "@/components/ui/empty";
import { SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Specimen } from "./Specimen";

/** A section's panel: its name over its text. */
const part = (name: string, text: string) => (
  <div className="flex flex-col gap-tight p-gutter">
    <h4 className="font-semibold text-ink text-title">{name}</h4>
    <p className="text-body text-ink">{text}</p>
  </div>
);

/** The sections keep which one is shown, so the specimen does too. */
function SectionTabsSpecimen() {
  const [shown, setShown] = useState("prerequisiti");
  return (
    <SectionTabs
      label="Sezioni"
      value={shown}
      onValueChange={setShown}
      steps={{ previous: "Sezione precedente", next: "Sezione successiva" }}
      className="w-full"
      sections={[
        {
          value: "obiettivi",
          label: "Obiettivi formativi",
          caption: "Scritta",
          content: part("Obiettivi formativi", "Conoscenza dei metodi di base."),
        },
        {
          value: "prerequisiti",
          label: "Prerequisiti",
          caption: "Scritta",
          content: part("Prerequisiti", "Analisi matematica I e Fisica I."),
        },
        {
          value: "altro",
          label: "Altro",
          caption: "Vuota",
          content: part("Altro", "Nessun testo."),
        },
      ]}
      foot={<p className="text-caption text-muted">Lingua del syllabus: Italiano</p>}
    />
  );
}

export function Surfaces() {
  return (
    <>
      <Specimen
        name="Card"
        note="Surface, hairline border, raised a step. CardHeader: an icon in a tinted disc, a title over a muted caption, a chip or a count at its end; CardFooter: a tinted foot behind a hairline. One that opens something lifts a pixel and takes the accent's hairline under the pointer."
      >
        <div className="grid w-full gap-snug sm:grid-cols-2">
          <Card interactive>
            <CardHeader
              icon={BookOpen}
              heading="Basi di dati"
              caption={<span className="font-mono">B024325 · 9 CFU</span>}
              aside={<Chip tone="accent">Corrente</Chip>}
            />
            <p className="px-gutter pb-snug text-body text-muted">Edizione 2026/27</p>
            <CardFooter>
              <AvatarStack names={["lconti"]} />
              <span className="flex-1 text-caption text-muted">1 docente</span>
              <Button variant="ghost" size="sm">
                Apri
                <ArrowRight aria-hidden className="size-icon" />
              </Button>
            </CardFooter>
          </Card>
          <Card>
            <CardHeader
              icon={GraduationCap}
              heading="Ingegneria Informatica"
              caption={<span className="font-mono">B249 · L-8</span>}
              aside={<Count value={8} />}
            />
            <p className="px-gutter pb-snug text-body text-muted">8 insegnamenti</p>
          </Card>
        </div>
      </Specimen>

      <Specimen
        name="Banner"
        note="A notice across what it is about, with a way on: info in the accent's tint, warn in the warning's for a failure. Its title in ink, the why in muted below."
      >
        <Banner
          icon={Lock}
          heading="Puoi vedere questa edizione, ma non assegnare docenti."
          action={
            <Button variant="outline" size="sm">
              Torna ai miei insegnamenti
            </Button>
          }
          className="w-full"
        >
          Solo la segreteria didattica e l'amministratore assegnano i docenti.
        </Banner>
        <Banner tone="warn" icon={Info} heading="La risposta si è interrotta." className="w-full">
          La parte già scritta resta qui sotto.
        </Banner>
      </Specimen>

      <Specimen
        name="Empty"
        note="A list with nothing in it yet: a dashed panel, a tinted disc with a picture, a title and one sentence, no button."
      >
        <Empty
          visual={<MessageSquare className="size-icon-lg" />}
          heading="Ancora nessuna conversazione"
          className="w-full max-w-xs"
        >
          Le domande che fai compaiono qui.
        </Empty>
      </Specimen>

      <Specimen
        name="Skeleton"
        note="The shape of a row still on its way, so a loading list never shows its empty state; it pulses where motion is allowed."
      >
        <div className="flex w-full max-w-xs flex-col gap-tight">
          <Skeleton className="w-4/5" />
          <Skeleton className="w-1/2" />
          <Skeleton className="w-3/4" />
        </div>
      </Specimen>

      <Specimen
        name="Table"
        note="Native table markup: TableHeader, TableBody, TableRow, TableHead, TableCell. A panel: the head on --tint, 36 px; rows of 54 px, a name over its code, a hairline between them; --hover under the pointer; selected, the row the reader opened and came back to, at --selected with its bar. Below sm each row stacks into a card."
      >
        <Table aria-label="Edizioni">
          <TableHeader>
            <TableRow>
              <TableHead>Insegnamento</TableHead>
              <TableHead>Anno accademico</TableHead>
              <TableHead>Stato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <span className="block font-semibold uppercase">
                  Progettazione e Produzione Multimediale
                </span>
                <span className="block font-mono text-caption text-muted">B028451</span>
              </TableCell>
              <TableCell label="Anno accademico">2025-2026</TableCell>
              <TableCell label="Stato">
                <StatusDot on={false}>Non corrente</StatusDot>
              </TableCell>
            </TableRow>
            <TableRow selected>
              <TableCell>
                <span className="block font-semibold uppercase">
                  Progettazione e Produzione Multimediale
                </span>
                <span className="block font-mono text-caption text-muted">B028451</span>
              </TableCell>
              <TableCell label="Anno accademico">2024-2025</TableCell>
              <TableCell label="Stato">
                <StatusDot on>Corrente</StatusDot>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Specimen>

      <Specimen
        name="Breadcrumb"
        note="The pages above this one, each a link, and this one marked as the current page, at 600; the area's icon may lead it in a tinted disc, left out on a phone."
      >
        <Breadcrumb
          label="Percorso"
          icon={GraduationCap}
          crumbs={[
            { label: "Corsi di laurea", to: "/staff/programmes" },
            { label: "B047 · INGEGNERIA INFORMATICA" },
          ]}
        />
      </Specimen>

      <Specimen
        name="SectionTabs"
        note="The numbered sections of one document, one at a time: one card, the sections down its side on the tint with a caption for each one's state, the shown one --selected with the accent's bar, what they share under them, and under the section the ones either side. Narrower than xl the list runs across the top and scrolls."
      >
        <SectionTabsSpecimen />
      </Specimen>
    </>
  );
}
