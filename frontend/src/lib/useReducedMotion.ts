import { useMediaQuery } from "./useMediaQuery";

/**
 * Whether the system asks for reduced motion, for what moves from script: the
 * living cat and the entry's intro. CSS asks for itself with `motion-reduce:`.
 * Rendered without a browser it answers yes: nothing moves.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)", true);
}
