import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useSession } from "./useSession";

/**
 * The guard on every page that is not a form for getting past it.
 *
 * `replace` so that the login page does not pile up in the back button, and the
 * attempted path travels in `state` so that a reader who was sent here from a
 * conversation link lands back on it rather than on the front page.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { account } = useSession();
  const location = useLocation();

  if (account === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
