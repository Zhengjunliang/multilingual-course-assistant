/**
 * A visitor's thread, kept in this tab and nowhere else.
 *
 * The server stores nothing for a reader without an account (docs/decisions.md,
 * 2026-09-25, *The data model is decided on paper*, point 3), so the thread
 * lives in the browser, and there it lives in `sessionStorage`: it survives a
 * reload and goes with the tab. Not `localStorage`, which would outlive the tab
 * on a shared lab computer and hand one student's questions to the next one
 * (outside the repository: OWASP's HTML5 Security Cheat Sheet prefers
 * `sessionStorage` wherever persistence is not needed).
 *
 * One thread at a time, as ChatGPT keeps a single one for a reader who is not
 * signed in (outside the repository). Signing in, signing up and signing out
 * empty it (auth/SessionProvider.tsx): a visitor's thread is not carried into
 * an account.
 *
 * Every access is wrapped, for the reason `ChatShell` gives about the sidebar
 * setting: a private window or blocked site data throws rather than returning
 * null, and a reader who cannot be remembered still gets a working page.
 */

import type { Turn } from "./useAsk";

const STORAGE_KEY = "mca.visitor-thread";

/**
 * Enough of a turn to render without a crash. The tab wrote it, so this is not
 * a defence against anyone but an older build of this file, whose turns lacked
 * a field the current one reads.
 */
function isTurn(value: unknown): value is Turn {
  const turn = value as Partial<Turn> | null;
  return (
    typeof turn === "object" &&
    turn !== null &&
    typeof turn.key === "string" &&
    typeof turn.question === "string" &&
    typeof turn.answer === "string" &&
    Array.isArray(turn.citations) &&
    typeof turn.complete === "boolean"
  );
}

/**
 * The thread as the tab left it.
 *
 * A turn stored before `end` arrived was cut off by a reload, and nothing will
 * finish it: it comes back as an interrupted answer, which is how a stored
 * conversation shows one too.
 */
export function readVisitorThread(): Turn[] {
  let stored: unknown;
  try {
    stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(stored) || !stored.every(isTurn)) return [];
  return stored.map((turn) =>
    turn.complete || turn.failure != null ? turn : { ...turn, failure: { kind: "incomplete" } },
  );
}

export function writeVisitorThread(turns: readonly Turn[]): void {
  try {
    if (turns.length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
  } catch {
    // The thread still holds on this page; it just will not survive a reload.
  }
}

export function clearVisitorThread(): void {
  writeVisitorThread([]);
}
