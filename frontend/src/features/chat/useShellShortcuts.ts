/**
 * The shell's four keys (shortcuts.ts), heard on the window from any
 * signed-in page, wherever the focus is: ChatShell.tsx says what each does.
 * The browser's own use of a key gives way (`preventDefault`), as it does for
 * ChatGPT's Ctrl ⇧ O over Chrome's bookmarks.
 *
 * The listener is added once; the actions are read from a ref, so a new
 * closure on every render does not take it off and put it back.
 */

import { useEffect, useRef } from "react";

import { type ShortcutName, shortcutOf } from "./shortcuts";

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
      latest.current[name]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
