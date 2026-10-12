/**
 * The catalogue's surfaces: what holds a page's content, a card, a table, the
 * path to where the reader is.
 */

import { ArrowRight, BookOpen, GraduationCap, Info, Lock, MessageSquare } from "lucide-react";

import { AvatarStack } from "@/components/ui/avatar-stack";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Specimen } from "./Specimen";

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
        note="Native table markup: TableHeader, TableBody, TableRow, TableHead, TableCell. Below sm each row stacks into a card; a row under the pointer wears --hover."
      >
        <Table aria-label="Edizioni">
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
    </>
  );
}
