/**
 * What the layout route around the chat and the staff pages hands the pages
 * it frames (routes/ShellLayout.tsx).
 *
 * Down: the programmes the caller may view, from which the Gestione group,
 * the landing of `/staff` and the breadcrumb's root follow (features/staff/landing.ts),
 * and the way back a "not found" page offers. Up: the breadcrumb a staff
 * page sets in the header, and the three things only the chat knows — that
 * its list of conversations changed, which conversation is being answered,
 * and how to stop that answer, which deleting the conversation does first.
 */

import { createContext, useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { Programme } from "@/api/catalog";
import type { Crumb } from "@/components/ui/breadcrumb";
import { crumbs, type StaffPage } from "@/features/staff/crumbs";
import type { ManagementKey } from "@/features/staff/landing";
import type { Back } from "@/features/staff/Refusal";

export interface Shell {
  /** `null` until the list arrives, and for an account with no staff page to read it for. */
  programmes: readonly Programme[] | null;
  /** Why the list did not arrive; `null` when it did, or has not been asked for. */
  programmesError: unknown;
  /** Where `/staff` sends the account; `null` when it has no staff page. */
  landing: string | null;
  /** The account's first Gestione item, the root of every breadcrumb. */
  root: ManagementKey | null;
  /** Where a "not found" page sends the reader: their own start. */
  back: Back;
  setCrumbs: (crumbs: readonly Crumb[]) => void;
  refreshConversations: () => void;
  /** The conversation being answered, or `null`; the chat clears it when it unmounts. */
  setBusy: (id: number | null) => void;
  /** How to stop the answer being written, or `null`; the chat clears it when it unmounts. */
  setStop: (stop: (() => void) | null) => void;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (shell === null) throw new Error("useShell needs ShellLayout above it");
  return shell;
}

/** Puts `page`'s breadcrumb in the header while the page is shown; `null` shows none yet. */
export function useCrumbs(page: StaffPage | null): void {
  const { root, setCrumbs } = useShell();
  const { t } = useTranslation();
  // The crumbs travel as text so the effect runs when they change, not on
  // every render that builds an equal list.
  const text = JSON.stringify(page === null ? [] : crumbs(page, root, t));
  useEffect(() => {
    setCrumbs(JSON.parse(text) as Crumb[]);
    return () => setCrumbs([]);
  }, [text, setCrumbs]);
}
