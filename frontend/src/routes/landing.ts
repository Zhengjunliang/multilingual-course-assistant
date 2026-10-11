/**
 * How the sign-in and registration forms answer a submit (#183): the button
 * spins while the server decides; a refusal counts once more, so the card
 * shakes and the cat reacts (routes/AuthLayout.tsx); an acceptance shows a
 * check for a moment and then leaves for where the reader was going. With
 * reduced motion there is no check to watch, and the page leaves at once.
 *
 * The session already holds the account when the check shows, so the pages
 * redirect a signed-in reader only while nothing is being sent: otherwise
 * the account arriving would take the page away before the check is seen.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useReducedMotion } from "@/lib/useReducedMotion";

export type Phase = "idle" | "busy" | "accepted";

/** How long the check shows before the page leaves, in milliseconds. */
export const ACCEPTED_FOR = 480;

export function useLanding(to: string) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusals, setRefusals] = useState(0);

  useEffect(() => {
    if (phase !== "accepted") return;
    const leave = setTimeout(
      () => void navigate(to, { replace: true }),
      reduced ? 0 : ACCEPTED_FOR,
    );
    return () => clearTimeout(leave);
  }, [phase, reduced, navigate, to]);

  /** Runs `attempt`, and hands what it threw to `refused`. */
  const send = useCallback(
    async (attempt: () => Promise<void>, refused: (error: unknown) => void) => {
      setPhase("busy");
      try {
        await attempt();
      } catch (error) {
        setPhase("idle");
        setRefusals((count) => count + 1);
        refused(error);
        return;
      }
      setPhase("accepted");
    },
    [],
  );

  return { phase, refusals, send };
}
