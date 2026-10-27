/**
 * What the layout route around the chat and the staff pages hands the pages
 * it frames (routes/ShellLayout.tsx).
 *
 * Down: the programmes the caller may view, from which the Gestione group,
 * the landing of `/staff` and the breadcrumb's root follow (features/staff/landing.ts),
 * and the way back a "not found" page offers. Up: the breadcrumb a staff
 * page sets in the header, and the two things only the chat knows — that its
 * list of conversations changed, and which conversation is being answered,
 * whose delete the sidebar must warn stops that answer.
 */

import { createContext, useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { Programme } from "@/api/catalog";
import type { Crumb } from "@/components/ui/breadcrumb";
import { area, crumbs, type StaffPage } from "@/features/staff/crumbs";
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
  setTrail: (trail: Trail) => void;
  refreshConversations: () => void;
  /** The conversation being answered, or `null`; the chat clears it when it unmounts. */
  setBusy: (id: string | null) => void;
}

/** The breadcrumb a staff page puts in the header, and the area whose icon leads it. */
export interface Trail {
  area: ManagementKey | null;
  crumbs: readonly Crumb[];
}

export const NO_TRAIL: Trail = { area: null, crumbs: [] };

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (shell === null) throw new Error("useShell needs ShellLayout above it");
  return shell;
}

/** Puts `page`'s breadcrumb in the header while the page is shown; `null` shows none yet. */
export function useCrumbs(page: StaffPage | null): void {
  const { root, setTrail } = useShell();
  const { t } = useTranslation();
  // The trail travels as text so the effect runs when it changes, not on
  // every render that builds an equal one.
  const text = JSON.stringify(
    page === null ? NO_TRAIL : { area: area(page, root), crumbs: crumbs(page, root, t) },
  );
  useEffect(() => {
    setTrail(JSON.parse(text) as Trail);
    return () => setTrail(NO_TRAIL);
  }, [text, setTrail]);
}
