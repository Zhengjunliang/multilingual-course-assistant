/**
 * The question being typed, kept in this tab with the address it was typed at
 * and the account that typed it.
 *
 * A session can end under the reader: it runs out, or they signed out in
 * another tab. The login page that takes over brings them back to the address
 * they were at (RequireSession.tsx), and the composer there starts from what
 * was kept. Only there: a question typed for one conversation does not belong
 * in another.
 *
 * One draft, the field's, which follows the reader from one conversation to
 * the next as the field does. `sessionStorage`, so that it goes when the tab
 * does. A screen can be shared, so the next reader does not find it: it is
 * given back to the account that typed it alone, and signing out empties it
 * (SessionProvider.tsx). A visitor keeps none, having no session to lose.
 * Like `localStorage` (i18n/index.ts), it throws in a private window or with
 * site data blocked, and a draft that cannot be kept is not kept.
 */

const KEY = "mca.draft";

interface Draft {
  account: number;
  at: string;
  text: string;
}

function isDraft(value: unknown): value is Draft {
  if (typeof value !== "object" || value === null) return false;
  const { account, at, text } = value as Record<string, unknown>;
  return typeof account === "number" && typeof at === "string" && typeof text === "string";
}

/** What `account` typed at `at` and did not send, or nothing. */
export function readDraft(account: number, at: string): string {
  try {
    const stored: unknown = JSON.parse(globalThis.sessionStorage?.getItem(KEY) ?? "null");
    return isDraft(stored) && stored.account === account && stored.at === at ? stored.text : "";
  } catch {
    return "";
  }
}

export function clearDraft(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing could have been kept.
  }
}

/** Keeps `text` as `account` typed it at `at`, in place of any other draft; an empty one keeps nothing. */
export function writeDraft(account: number, at: string, text: string): void {
  if (text === "") {
    clearDraft();
    return;
  }
  const draft: Draft = { account, at, text };
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Not kept, as above.
  }
}
