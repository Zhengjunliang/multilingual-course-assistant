import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, for what script has to decide where CSS
 * cannot: the reduced motion the living cat asks for, the direction a tab list
 * is read in at the width it is drawn at.
 *
 * Read where React reads external state, so the first frame already knows it
 * and a change while the page is open is followed. Rendered without a
 * browser, as the styleguide's test does, it answers `server`.
 */
export function useMediaQuery(query: string, server: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => server,
  );
}
