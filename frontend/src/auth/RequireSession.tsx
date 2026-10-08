import type { ReactNode } from "react";
import { Navigate, useLocation, useMatch } from "react-router-dom";

import { useSession } from "./useSession";

interface RequireSessionProps {
  children: ReactNode;
  /**
   * What a reader without an account gets on `/`, the one page open to them:
   * campus questions, with nothing stored (docs/decisions.md,
   * 2026-09-25, *The data model is decided on paper*, point 3).
   */
  visitor: ReactNode;
}

/**
 * The guard on every page that is not a form for getting past it, but the
 * front page, where a visitor gets `visitor` instead. A stored conversation and
 * the staff pages need an account.
 *
 * `replace` so that the login page does not pile up in the back button, and the
 * attempted path travels in `state` so that a reader who was sent here from a
 * conversation link lands back on it rather than on the front page; with its
 * query, which names the programme a staff page was reached through.
 */
export function RequireSession({ children, visitor }: RequireSessionProps) {
  const { account } = useSession();
  const location = useLocation();
  const front = useMatch("/") !== null;

  if (account !== null) return <>{children}</>;
  if (front) return <>{visitor}</>;
  return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}
