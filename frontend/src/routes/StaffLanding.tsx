/**
 * `/staff` itself, and any staff path that names no page.
 *
 * `/staff` sends the account to its first Gestione item (features/staff/landing.ts),
 * once the programme list has said what that is; an account with none goes
 * to the chat. A path under `/staff` that matches no page is "not found",
 * inside the shell, with the way back to the reader's own start.
 */

import { Navigate } from "react-router-dom";

import { LoadFailure, NotFound } from "@/features/staff/Refusal";
import { useCrumbs, useShell } from "./shell";

export default function StaffLanding() {
  const { landing, programmes, programmesError, back } = useShell();

  if (landing !== null) return <Navigate to={landing} replace />;
  if (programmesError !== null) return <LoadFailure error={programmesError} back={back} />;
  // Still on its way: the account's start is not known yet.
  if (programmes === null) return null;
  return <Navigate to="/" replace />;
}

export function StaffNotFound() {
  const { back } = useShell();
  useCrumbs({ kind: "notFound" });
  return <NotFound back={back} />;
}
