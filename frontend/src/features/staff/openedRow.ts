/**
 * The row of a staff table the reader opened, marked when they come back to
 * the table with Back, and its link given the focus again, as Linear's lists
 * and the Finder keep the item a reader left from: a page reached with Back
 * otherwise drops the focus to the top of the document.
 *
 * The row is noted against the history entry the reader leaves, by the
 * router's `location.key`, which Back returns to and a new visit does not:
 * the same table reached from the sidebar or a breadcrumb is a new entry,
 * and marks nothing. The first entry of every page loaded afresh, from a
 * bookmark or the address bar, has the same key, "default", so that entry
 * is told apart by the document's load instead (`performance.timeOrigin`,
 * new on every load and kept while Back stays within it), and every entry
 * by its address too. A click that opens the row in another tab or
 * window, with a modifier or another button, leaves this page where it is,
 * and notes nothing, by the rule React Router's own links follow. It is
 * kept in `sessionStorage`, so a reload in between keeps it, except for the
 * first entry of a load, which a reload turns into another load; storage
 * may be refused, and the table is then simply unmarked.
 * Noting it is a write before the link's own navigation rather than a second
 * navigation that replaces the entry's state, which the router's next
 * navigation would interrupt.
 *
 * The focus moves once per visit, when the table's rows are first there, so
 * a page that reads again after a dialog leaves the focus where the dialog
 * put it.
 */

import { type MouseEvent, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const STORE = "mca.openedRows";

function rows(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function note(entry: string, row: string): void {
  try {
    sessionStorage.setItem(STORE, JSON.stringify({ ...rows(), [entry]: row }));
  } catch {
    // Unmarked on the way back, and nothing else lost.
  }
}

interface OpenedRow {
  /** The key of the row the reader opened from this entry, or null. */
  opened: string | null;
  /** The onClick of the link of the row with `key`. */
  open: (key: string) => (event: MouseEvent) => void;
}

/** `ready` once the table's rows are drawn: the focus waits for them. */
export function useOpenedRow(ready: boolean): OpenedRow {
  const { key, pathname, search } = useLocation();
  const entry = `${key === "default" ? performance.timeOrigin : key} ${pathname}${search}`;
  const opened = rows()[entry] ?? null;
  const focused = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || opened === null || focused.current === entry) return;
    focused.current = entry;
    const link = document.querySelector<HTMLElement>("main tr[data-selected] a");
    link?.focus();
    // jsdom has no layout, and no scrollIntoView.
    link?.scrollIntoView?.({ block: "nearest" });
  }, [ready, opened, entry]);

  return {
    opened,
    open: (row) => (event) => {
      const elsewhere =
        event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (!elsewhere) note(entry, row);
    },
  };
}
