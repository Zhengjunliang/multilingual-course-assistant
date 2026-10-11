import { useSyncExternalStore } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const read = () => window.matchMedia(REDUCE).matches;

/**
 * Whether the system asks for reduced motion, for what moves from script: the
 * living cat and the entry's intro. CSS asks for itself with `motion-reduce:`.
 *
 * Read where React reads external state, so the first frame already knows it
 * and a change while the page is open is followed. Rendered without a
 * browser, as the styleguide's test does, it answers yes: nothing moves.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
