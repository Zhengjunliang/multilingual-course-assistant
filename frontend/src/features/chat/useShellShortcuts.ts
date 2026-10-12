/**
 * The shell's four keys (shortcuts.ts), heard on the window from any
 * signed-in page, wherever the focus is: ChatShell.tsx says what each does.
 * The browser's own use of a key gives way (`preventDefault`), as it does for
 * ChatGPT's Ctrl ⇧ O over Chrome's bookmarks.
 *
 * Not while a dialog other than the drawer is open, such as a deletion's
 * confirmation waiting for the server or the settings: a key would act behind
 * it, or take it away with the drawer it was opened from. The document is
 * asked, not the focus, because a confirmation waiting for the server has
 * disabled its buttons and the focus has fallen to the page's body. The
 * drawer itself is the sidebar, and the keys work there. A key held back is
 * still kept from the browser, so it does not open Chrome's bookmarks
 * behind the dialog instead.
 *
 * The listener is added once; the actions are read from a ref, so a new
 * closure on every render does not take it off and put it back.
 */

import { useEffect, useRef } from "react";

import { type ShortcutName, shortcutOf } from "./shortcuts";

/** Whether a dialog is open that does not hold the sidebar's panel. */
function anotherLayerOpen(): boolean {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
    (layer) => layer.querySelector("[data-sidebar-panel]") === null,
  );
}

export function useShellShortcuts(actions: Record<ShortcutName, () => void>): void {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const name = shortcutOf(event);
      if (name === null) return;
      event.preventDefault();
      if (!anotherLayerOpen()) latest.current[name]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
