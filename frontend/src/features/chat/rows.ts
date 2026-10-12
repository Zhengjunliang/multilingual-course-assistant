/**
 * What a conversation row in the sidebar shows besides its title: when the
 * conversation started, and whether the search field finds it.
 *
 * The time is the conversation's `created_at`, the order the list arrives in
 * (apps/qa/models.py). Today it is the hour; yesterday the word for it, which
 * `Intl.RelativeTimeFormat` spells in each language ("Ieri", "Yesterday",
 * "昨天"), so no catalogue repeats it; before that the day and the month, and
 * the year once it is not this one. All in the interface's language.
 *
 * The search folds case and accents on both sides, so "perche" finds
 * "Perché": a reader typing fast leaves the accents out, and a title written
 * by the server keeps them.
 *
 * How a row of the sidebar is drawn, a conversation or a Gestione page alike
 * (DESIGN.md, the five rules): the accent at 6 % under the pointer, and where
 * the reader is, the accent at 11 % with a 3 px bar at its leading edge and
 * the label in the accent at 600.
 */

export const SIDEBAR_ROW =
  "relative flex min-h-control-sm items-center gap-tight rounded-control px-tight text-body text-ink transition-colors hover:bg-hover";

export const SIDEBAR_ROW_CURRENT =
  "bg-selected font-semibold text-accent hover:bg-selected before:absolute before:inset-y-tight before:left-0 before:w-bar before:rounded-r-full before:bg-accent";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function startedLabel(createdAt: string, locale: string, now: Date = new Date()): string {
  const started = new Date(createdAt);
  // Rounded, since a day across a change of clock is 23 or 25 hours long.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(started)) / DAY);
  if (daysAgo <= 0) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(started);
  }
  if (daysAgo === 1) {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
    return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
  }
  const thisYear = started.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: thisYear ? undefined : "numeric",
  }).format(started);
}

function folded(text: string, locale: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(locale);
}

/** Whether `title` contains what was typed; an empty search finds everything. */
export function titleMatches(title: string, query: string, locale: string): boolean {
  const wanted = folded(query.trim(), locale);
  return wanted === "" || folded(title, locale).includes(wanted);
}
