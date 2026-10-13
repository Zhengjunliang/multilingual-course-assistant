/**
 * The four keys every signed-in page answers to, wherever the focus is: a new
 * conversation, the search, the settings and the list of shortcuts
 * (ChatShell.tsx listens for them; the controls they stand for show them on a
 * `Kbd`).
 *
 * New conversation and search are ChatGPT's (Ctrl ⇧ O, Ctrl K); the
 * settings take the comma that macOS gives every application's preferences,
 * and the list takes `?`, as GitHub, Gmail and Linear do. Apple's keyboards
 * write ⌘ where the others write Ctrl, so the caps follow the platform, and so
 * does the key heard: on a Mac, Ctrl stays the text field's own (Ctrl K
 * deletes to the end of the line), as ChatGPT leaves it.
 *
 * `?` alone is a character, so it is heard only outside a field: in the
 * question box it is the end of a question. So is `/`, which a page with a
 * filter takes to put the focus in it, as GitHub, Gmail and YouTube do: the
 * study plan's (features/staff/StudyPlanTable.tsx). It waits while any layer
 * is open, the narrow-screen drawer included, since the filter is behind it.
 */

import type { Shortcut } from "@/components/ui/kbd";

export type ShortcutName = "newConversation" | "search" | "settings" | "help";

/** Whether the reader is on Apple's keyboards, where ⌘ does what Ctrl does elsewhere. */
export function onApple(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** Each shortcut's keys, as `aria-keyshortcuts` names them and its cap shows them. */
export function shortcuts(isApple: boolean = onApple()): Record<ShortcutName, Shortcut> {
  const [key, cap] = isApple ? ["Meta", "⌘"] : ["Control", "Ctrl"];
  return {
    newConversation: { keys: `${key}+Shift+O`, label: `${cap} ⇧ O` },
    search: { keys: `${key}+K`, label: `${cap} K` },
    settings: { keys: `${key}+,`, label: `${cap} ,` },
    help: { keys: "?", label: "?" },
  };
}

export const FILTER: Shortcut = { keys: "/", label: "/" };

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Which shortcut a key press is, if any. */
export function shortcutOf(
  event: KeyboardEvent,
  isApple: boolean = onApple(),
): ShortcutName | null {
  // A browser's autofill sends a keydown with no key at all.
  if (typeof event.key !== "string" || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (isApple ? event.metaKey : event.ctrlKey) {
    if (key === "o" && event.shiftKey) return "newConversation";
    if (key === "k" && !event.shiftKey) return "search";
    if (key === ",") return "settings";
    return null;
  }
  if (event.ctrlKey || event.metaKey) return null;
  return key === "?" && !typingIn(event.target) ? "help" : null;
}

/** Whether a key press is the page filter's `/`: no modifier but the one some layouts type it with. */
export function isFilterKey(event: KeyboardEvent): boolean {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (typingIn(event.target)) return false;
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') === null;
}
