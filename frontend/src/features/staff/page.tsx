/**
 * The parts every staff page is built from, so each page says what it holds
 * and not how a heading is spaced: its header, its sections, and a note.
 *
 * The header is the prototype's: «Gestione» above the title, as the sidebar
 * group the page belongs to, then the page's facts as chips — a code, the
 * curricula, a count, a year and its state — and a line saying more where
 * the chips do not (DESIGN.md, rules 1 and 2).
 *
 * The page's `h1` takes focus when asked (`tabIndex={-1}`): it is where focus
 * goes when what a dialog was opened from is gone (features/staff/).
 */

import { Database, Info } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Chip } from "@/components/ui/chip";
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
  sub?: ReactNode;
  /** Beside the heading: the section's one action. */
  right?: ReactNode;
  children: ReactNode;
}

export function Section({ heading, sub, right, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-snug">
      <div className="flex flex-wrap items-end gap-snug">
        <div className="flex min-w-0 flex-1 flex-col gap-hair">
          <h2 className="font-semibold text-ink text-title">{heading}</h2>
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
