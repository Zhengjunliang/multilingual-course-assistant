import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { isStaff } from "./staff";
import { useSession } from "./useSession";

/**
 * The staff area's guard, inside `RequireSession`: an account with no role is
 * sent to the chat, as Open WebUI's admin layout sends a non-admin home
 * (outside the repository: Open WebUI source). The server refuses the same
 * calls whatever this says; the guard only spares a page that would be empty.
 */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { account } = useSession();

  if (account === null || !isStaff(account)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
