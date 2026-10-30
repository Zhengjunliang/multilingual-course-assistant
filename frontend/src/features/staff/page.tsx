/**
 * The parts every staff page is built from, so each page says what it holds
 * and not how a heading is spaced: its header, its sections, a note, and the
 * way through a list the server sends in pages.
 *
 * The header is the prototype's: «Gestione» above the title, as the sidebar
 * group the page belongs to, then the page's facts as chips — a code, the
 * curricula, a count, a year and its state — and a line saying more where
 * the chips do not (DESIGN.md, rules 1 and 2).
 *
 * The page's `h1` takes focus when asked (`tabIndex={-1}`): it is where focus
 * goes when what a dialog was opened from is gone (features/staff/).
 */

import { ChevronLeft, ChevronRight, Database, Info } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { cn } from "@/lib/utils";

interface PageHeadProps {
  heading: string;
  /** Whether the heading is a catalogue name, printed in capitals as the catalogue prints it. */
  caps?: boolean;
  /** The facts of what the page shows, as chips, under the heading. */
  chips?: ReactNode;
  sub?: ReactNode;
  /** Whether to name where the study plans come from. */
  source?: boolean;
  actions?: ReactNode;
}

export function PageHead({ heading, caps, chips, sub, source, actions }: PageHeadProps) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-end gap-snug">
      <div className="flex min-w-0 flex-1 flex-col gap-hair">
        <p className="font-semibold text-caption text-muted uppercase">
          {t("staff.nav.management")}
        </p>
        <h1
          tabIndex={-1}
          className={cn("font-semibold text-display text-ink outline-none", caps && "uppercase")}
        >
          {heading}
        </h1>
        {chips !== undefined && <div className="mt-hair flex flex-wrap gap-tight">{chips}</div>}
        {sub !== undefined && <p className="text-body text-muted">{sub}</p>}
        {source && (
          <p className="flex items-center gap-tight text-caption text-muted">
            <Database aria-hidden className="size-icon shrink-0" />
            {t("staff.source")}
          </p>
        )}
      </div>
      {actions !== undefined && <div className="flex items-center gap-tight">{actions}</div>}
    </header>
  );
}

interface SectionProps {
  heading: string;
  /** How many rows it holds, beside the heading. */
  count?: number;
  sub?: ReactNode;
  /** Beside the heading: the section's one action. */
  right?: ReactNode;
  children: ReactNode;
}

export function Section({ heading, count, sub, right, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-snug">
      <div className="flex flex-wrap items-end gap-snug">
        <div className="flex min-w-0 flex-1 flex-col gap-hair">
          <div className="flex items-center gap-tight">
            <h2 className="font-semibold text-ink text-title">{heading}</h2>
            {count !== undefined && <Count value={count} />}
          </div>
          {sub !== undefined && <p className="text-body text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A code of the catalogue, set apart as the catalogue's identifier it is: a neutral chip. */
export function Code({ children }: { children: ReactNode }) {
  return <Chip className="font-mono">{children}</Chip>;
}

/** A note under what it is about: under a table, or across the foot of a card (`foot`). */
export function Note({ children, foot }: { children: ReactNode; foot?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-start gap-tight text-caption text-muted",
        foot && "border-line border-t px-snug py-tight",
      )}
    >
      <Info aria-hidden className="size-icon shrink-0" />
      <span>{children}</span>
    </p>
  );
}

interface PagerProps {
  /** From 1. */
  page: number;
  count: number;
  /** The rows of a full page, the server's `page_size`. */
  size: number;
  /** Whether the server named a page before this one, and after it. */
  previous: boolean;
  next: boolean;
  onPage: (page: number) => void;
}

/**
 * Under a list the server sends in pages: which page of how many, and the way
 * to the one before and after, as DRF's `previous` and `next` allow. Nothing
 * for a list of one page.
 */
export function Pager({ page, count, size, previous, next, onPage }: PagerProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(count / size));
  if (pages === 1) return null;
  return (
    <nav aria-label={t("staff.pager.label")} className="flex items-center justify-end gap-tight">
      <span className="text-caption text-muted tabular-nums">
        {t("staff.pager.page", { page, pages })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!previous}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft aria-hidden className="size-icon" />
        {t("staff.pager.previous")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!next}
        onClick={() => onPage(page + 1)}
      >
        {t("staff.pager.next")}
        <ChevronRight aria-hidden className="size-icon" />
      </Button>
    </nav>
  );
}
