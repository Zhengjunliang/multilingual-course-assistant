/**
 * The catalogue's surfaces: what holds a page's content, a card, a table, the
 * path to where the reader is.
 */

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card } from "@/components/ui/card";
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
      <Specimen name="Card" note="Surface, hairline border, raised a step off the page.">
        <Card className="flex w-full max-w-sm flex-col gap-hair p-gutter">
          <p className="font-medium text-body text-ink">A card</p>
          <p className="text-caption text-muted">Its content and padding are the page's own.</p>
        </Card>
      </Specimen>

      <Specimen
        name="Table"
        note="Native table markup: TableHeader, TableBody, TableRow, TableHead, TableCell. Below sm each row stacks into a card; a row under the pointer wears --mark."
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
