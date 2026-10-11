/**
 * How the sign-in and registration forms answer a submit (#183): the button
 * spins while the server decides; a refusal counts once more, so the card
 * shakes and the cat reacts (routes/AuthLayout.tsx); an acceptance shows a
 * check for a moment and then leaves for where the reader was going. With
 * reduced motion there is no check to watch, and the page leaves at once.
 *
 * Bound for the entry at `/`, the cat jumps there (#183): it crouches on the
 * card, and the page changes inside a view transition (React Router's
 * `viewTransition`, the browser's `document.startViewTransition`), in which
 * index.css flies the cat in an arc from its place on the card to its place
 * on the entry while the card falls away, after the same-document view
 * transitions of Chrome's documentation (outside the repository). The entry
 * asks `leapt()` as it appears, and rises into place under the cat. A browser
 * without view transitions changes the page without the flight; reduced
 * motion and any other destination change it with no jump at all.
 *
 * The session already holds the account when the check shows, so the pages
 * redirect a signed-in reader only while nothing is being sent: otherwise
 * the account arriving would take the page away before the check is seen.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useReducedMotion } from "@/lib/useReducedMotion";

export type Phase = "idle" | "busy" | "accepted" | "crouching";

/** How long the check shows before the page leaves, in milliseconds. */
export const ACCEPTED_FOR = 480;

/** How long the cat crouches before it jumps, in milliseconds: `crouch` in index.css. */
export const CROUCH = 150;

/** When the cat last jumped for the entry, on `performance.now()`'s clock. */
let jumpedAt = Number.NEGATIVE_INFINITY;

/**
 * Whether the entry appearing now is where the cat has just jumped to. Read as
 * the entry appears; a time rather than a flag taken once, so that reading it
 * twice, as React's strict mode does, gives the same answer, and a reload,
 * which starts the clock again, gives no.
 */
export function leapt(): boolean {
  return performance.now() - jumpedAt < 1000;
}

export function useLanding(to: string) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusals, setRefusals] = useState(0);

  useEffect(() => {
    if (phase === "accepted") {
      const jumps = to === "/" && !reduced;
      const next = setTimeout(
        () => (jumps ? setPhase("crouching") : void navigate(to, { replace: true })),
        reduced ? 0 : ACCEPTED_FOR,
      );
      return () => clearTimeout(next);
    }
    if (phase === "crouching") {
      const jump = setTimeout(() => {
        jumpedAt = performance.now();
        void navigate(to, { replace: true, viewTransition: "startViewTransition" in document });
      }, CROUCH);
      return () => clearTimeout(jump);
    }
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
