/**
 * Rendering into a real document, for the half `render.tsx` cannot reach.
 *
 * The two helpers are not versions of each other. `render` walks a tree once
 * and hands back a string: no effect runs, no event fires, nothing is attached
 * to anything, and that is exactly what a test about markup wants — it is fast,
 * it needs no environment, and it cannot accidentally assert on behaviour.
 * `mount` builds a live document instead, which is what the other kind of test
 * needs: a Radix portal has somewhere to go, an effect runs, a click does
 * something. Asking one helper to do both jobs would make every markup
 * assertion pay for a synthetic browser.
 *
 * A file that calls this must open with `@vitest-environment jsdom`. The
 * default is `node` on purpose; vite.config.ts says why.
 *
 * `act` comes from React itself in 19 and `createRoot` from `react-dom/client`,
 * so this is a document and nothing else — no testing library, no queries, no
 * matchers. Tests read the container, or `document.body` when what they are
 * looking for was portalled out of it.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import "@/i18n";

export interface Mounted {
  /** The element the tree was rendered into. Portals are *not* inside it. */
  container: HTMLElement;
  unmount: () => void;
}

export function mount(element: ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
