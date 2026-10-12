/**
 * A data table: the native elements, under the heading of the section it sits in.
 *
 * A panel, as every list is (DESIGN.md, rule 4): a 1 px border and the card's
 * corners, its head row on `--tint`, 36 px tall, behind a line, and its rows
 * at least 54 px, room for a name over its code (rule 1), with a hairline
 * between them. The row the reader opened and came back to with Back is
 * `selected`: the accent at 11 % with the 3 px bar at its leading edge, as
 * the sidebar draws where the reader is. The bar is drawn inset along the
 * row's first cell, not as a pseudo-element of the row: Chrome lays a row's
 * generated box out as a cell of its own, absolutely positioned or not,
 * and every cell after it moves a column; a stacked row has none, its card
 * tinted alone. It is marked with `data-selected` and not
 * `aria-selected`, which a row of a plain table does not take; focus going
 * back to the row's link is what a screen reader hears.
 *
 * Native `<table>` markup rather than a grid of `div`s with ARIA roles, since
 * the browser then gives a screen reader the rows, columns and headers itself
 * (outside the repository: WAI-ARIA APG, "Table Pattern"). A table whose
 * headers stick to the top of the page lets its frame go where the screen is
 * wide enough (`frameClassName`), since a sticky cell sticks to the nearest
 * frame that scrolls. The frame is also the
 * containing block of what is positioned inside it — a screen-reader label, a
 * row's stretched link — so nothing absolute escapes it and widens the page. A
 * row under the pointer wears `--hover`, the accent's 6 %, as everything else
 * under the pointer does.
 *
 * Below `sm` every row stacks into a card, the U.S. Web Design System's
 * "stacked" table (outside the repository): a phone has no width for five
 * columns, and scrolling a frame sideways hid the last of them. The header row
 * is kept for screen readers and hidden from sight; a cell given a `label`
 * shows it to sighted readers before its value, and the cell that names the
 * row needs none. Changing
 * `display` on table elements makes WebKit drop their table semantics (outside
 * the repository: Adrian Roselli, "Tables, CSS Display Properties, and ARIA"),
 * so every element of it states its role, which is redundant everywhere else
 * and restores the table there. The header row is no exception: `sr-only`
 * positions it absolutely, which turns it into a block as well.
 */

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Table({
  className,
  frameClassName,
  ...props
}: ComponentProps<"table"> & { frameClassName?: string }) {
  return (
    <div
      className={cn(
        "relative w-full overflow-x-auto rounded-card border border-line bg-surface sm:[&_tbody:last-child>tr:last-child]:border-b-0",
        frameClassName,
        "max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent",
      )}
    >
      <table
        // biome-ignore lint/a11y/noRedundantRoles: restores the role a stacked table loses in WebKit
        role="table"
        className={cn("w-full border-collapse text-body max-sm:block", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      // biome-ignore lint/a11y/noRedundantRoles: restores the role a stacked table loses in WebKit
      role="rowgroup"
      className={cn(
        "[&>tr]:h-auto [&>tr]:border-line [&>tr>th:first-child]:rounded-tl-card [&>tr>th:last-child]:rounded-tr-card max-sm:sr-only",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      // biome-ignore lint/a11y/noRedundantRoles: restores the role a stacked table loses in WebKit
      role="rowgroup"
      className={cn("max-sm:flex max-sm:flex-col max-sm:gap-tight", className)}
      {...props}
    />
  );
}

const SELECTED =
  "data-selected:bg-selected data-selected:hover:bg-selected sm:data-selected:[&>td:first-child]:shadow-[inset_var(--spacing-bar)_0_var(--color-accent)]";

export function TableRow({
  className,
  selected = false,
  ...props
}: ComponentProps<"tr"> & {
  /** The row the reader opened, on coming back to the table. */
  selected?: boolean;
}) {
  return (
    <tr
      // biome-ignore lint/a11y/noRedundantRoles: restores the role a stacked table loses in WebKit
      role="row"
      data-selected={selected || undefined}
      className={cn(
        "h-table-row border-hairline border-b transition-colors hover:bg-hover max-sm:h-auto",
        SELECTED,
        "max-sm:flex max-sm:flex-col max-sm:gap-hair max-sm:rounded-card max-sm:border max-sm:bg-surface max-sm:p-snug max-sm:shadow-raised",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: restores the role a stacked table loses in WebKit
    <th
      role="columnheader"
      className={cn(
        "h-table-head whitespace-nowrap bg-tint px-snug text-left font-semibold text-caption text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  label,
  children,
  ...props
}: ComponentProps<"td"> & {
  /** Printed before the value when the row stacks into a card: its column's header. */
  label?: string;
}) {
  return (
    <td
      // biome-ignore lint/a11y/noRedundantRoles: restores the role a stacked table loses in WebKit
      role="cell"
      className={cn(
        "px-snug py-tight align-middle text-ink",
        "max-sm:flex max-sm:gap-tight max-sm:p-0 max-sm:text-left",
        className,
      )}
      {...props}
    >
      {/* Hidden from screen readers, which hear the column's header already. */}
      {label !== undefined && (
        <span aria-hidden className="hidden w-28 shrink-0 text-caption text-muted max-sm:block">
          {label}
        </span>
      )}
      {/* One box for the value, so that a cell of several parts keeps them
          together beside its label instead of laying them out in a row. */}
      <div className="min-w-0 flex-1">{children}</div>
    </td>
  );
}
