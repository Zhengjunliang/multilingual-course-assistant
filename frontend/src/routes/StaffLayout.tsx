/**
 * The column the staff pages share inside the chat shell: it scrolls, and
 * holds the page at a readable width.
 *
 * The shell's own frame (ShellLayout) holds the sidebar, the header and the
 * breadcrumb; the chat's thread is its own scroller, and this is the staff
 * pages'. A table's sticky row headers stick to this scroller's top.
 */

import { Outlet } from "react-router-dom";

export default function StaffLayout() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-gutter pb-room">
      <div className="mx-auto flex max-w-5xl flex-col gap-room pt-snug">
        <Outlet />
      </div>
    </main>
  );
}
