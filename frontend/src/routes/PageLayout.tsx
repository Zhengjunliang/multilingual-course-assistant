/**
 * The column every page of the shell but the chat sits in, the staff pages
 * and the account's: it scrolls, and holds the page at a readable width.
 *
 * The shell's own frame (ShellLayout) holds the sidebar, the header and the
 * breadcrumb; the chat's thread is its own scroller, and this is the other
 * pages'. A table's sticky row headers stick to this scroller's top.
 *
 * It is `relative` so that it holds what is positioned inside it: a
 * screen-reader-only text (`sr-only`) is absolutely positioned, and with no
 * positioned ancestor it would be placed against the page, below the fold of
 * a long page, and make the whole frame scroll beside this column.
 */

import { Outlet } from "react-router-dom";

export default function PageLayout() {
  return (
    <main className="relative min-h-0 flex-1 overflow-y-auto px-gutter pb-room">
      <div className="mx-auto flex max-w-5xl flex-col gap-room pt-snug">
        <Outlet />
      </div>
    </main>
  );
}
