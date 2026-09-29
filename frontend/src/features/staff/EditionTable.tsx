/**
 * The editions in the caller's scope, filtered in the browser by year and text.
 *
 * Filtering here and not on the server while the list holds a few hundred
 * rows, as Geist's and shadcn's tables filter in the client (docs/decisions.md).
 * "Make current" is offered on a row that is not current and that the server
 * says the caller may switch, `can_set_current`, so the button never leads to a
 * refusal the page could have foreseen. The empty state is outside the table,
 * as Geist puts it (outside the repository: vercel.com/geist/table).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Edition } from "@/api/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EditionTableProps {
  editions: readonly Edition[];
  onSetCurrent: (edition: Edition) => void;
}

function matches(edition: Edition, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    edition.course.code,
    edition.course.name,
    ...edition.teachers.map((m) => m.username),
  ];
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

export function EditionTable({ editions, onSetCurrent }: EditionTableProps) {
  const { t } = useTranslation();
  const [year, setYear] = useState<string | null>(null);
  const [text, setText] = useState("");
  const years = [...new Set(editions.map((e) => e.academic_year))].sort().reverse();
  const shown = editions.filter(
    (e) => (year === null || e.academic_year === year) && matches(e, text),
  );

  return (
    <div className="flex flex-col gap-snug">
      <div className="flex flex-wrap items-center gap-tight">
        <fieldset aria-label={t("staff.editions.year")} className="flex flex-wrap gap-hair">
          {[null, ...years].map((choice) => (
            <Button
              key={choice ?? "all"}
              type="button"
              size="sm"
              variant={year === choice ? "outline" : "ghost"}
              aria-pressed={year === choice}
              onClick={() => setYear(choice)}
            >
              {choice ?? t("staff.editions.allYears")}
            </Button>
          ))}
        </fieldset>
        <Input
          type="search"
          value={text}
          aria-label={t("staff.editions.filter")}
          placeholder={t("staff.editions.filter")}
          className="max-w-xs"
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-body text-muted">{t("staff.editions.empty")}</p>
      ) : (
        <Table>
          <TableCaption>{t("staff.editions.caption")}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.editions.course")}</TableHead>
              <TableHead>{t("staff.editions.year")}</TableHead>
              <TableHead>{t("staff.editions.status")}</TableHead>
              <TableHead>{t("staff.editions.teachers")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("staff.editions.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((edition) => (
              <TableRow key={edition.id}>
                <TableCell>
                  <Link to={`/staff/editions/${edition.id}`} className="hover:underline">
                    <span className="font-mono text-caption text-muted">{edition.course.code}</span>{" "}
                    {edition.course.name}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{edition.academic_year}</TableCell>
                <TableCell>
                  {edition.is_current && <Badge>{t("staff.editions.current")}</Badge>}
                </TableCell>
                <TableCell className="text-muted">
                  {edition.teachers.map((m) => m.username).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right">
                  {!edition.is_current && edition.can_set_current && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={t("staff.setCurrent.action", {
                        course: edition.course.code,
                        year: edition.academic_year,
                      })}
                      onClick={() => onSetCurrent(edition)}
                    >
                      {t("staff.editions.setCurrent")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
