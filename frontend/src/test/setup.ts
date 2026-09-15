/**
 * The three browser APIs jsdom does not have, and this repository does call.
 *
 * jsdom implements the DOM, not the browser around it. Layout, media queries
 * and scrolling are all outside its scope, and code already written here walks
 * into each one:
 *
 * - `theme/ThemeProvider.tsx` calls `window.matchMedia` inside a `useState`
 *   initialiser, so it throws before a component can render at all;
 * - `features/chat/CitationList.tsx` calls `scrollIntoView` when the
 *   highlighted card changes;
 * - Radix positions a dropdown with a `ResizeObserver`.
 *
 * These stubs are deliberately dumb, and the first one has a consequence worth
 * stating: a media query that always answers `false` means the "system" theme
 * resolves to light here and can never be tested. That check belongs to the
 * manual list in the pull request. The other two do nothing and are only asked
 * not to throw — position and scrolling are things a person has to look at.
 *
 * `PointerEvent` and `CSS.escape` are *not* stubbed. jsdom 30 has both, and a
 * stub over a working API is dead code that hides the real one's behaviour.
 *
 * This file runs for every test file, and most of them stay on the `node`
 * environment with no window at all, so it checks before it reaches for one.
 */

/**
 * React 19 wants this before `act` will drive an update without warning.
 *
 * Cast rather than `declare global`: the flag belongs to React's test harness,
 * not to this project's type surface, and widening `globalThis` here would put
 * it in scope for every file in `src/`.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
}
