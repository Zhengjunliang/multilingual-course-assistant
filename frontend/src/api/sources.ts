/**
 * `/api/sources/<sha256>` — the PDF a slides citation came from.
 *
 * Opened in a new tab rather than fetched: the browser's own PDF viewer reads
 * `#page=N` and lands on the cited page, so there is nothing for this client to
 * render. The session cookie goes with the navigation as it does with any
 * same-origin request.
 */

/** The PDF at the cited page. `page` is one-based, as the citation carries it. */
export function sourceHref(sha256: string, page: number): string {
  return `/api/sources/${sha256}#page=${page}`;
}
