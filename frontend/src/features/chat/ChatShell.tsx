/**
 * The frame around a conversation: the sidebar, its narrow-screen drawer, and
 * the row of controls above the thread.
 *
 * Lifted out of `ChatPage` for two reasons, and the test harness is neither of
 * them. The first is that the button which opens the drawer and the state it
 * opens now live in the same component: until this existed, the button sat in
 * the header bar and the boolean sat in `ChatPage`, joined by an
 * `onOpenSidebar` prop threaded between them — a prop whose only job was to
 * cross a boundary that should not have been there. The second is that
 * `ChatPage` was carrying four unrelated jobs at once: keeping the URL and the open conversation in
 * step, holding the streaming state, laying out the frame, and choosing between
 * an empty page and a thread. The frame is the one that has nothing to do with
 * the other three.
 *
 * What stays in `ChatPage` is deliberate: the composer. It moves between the
 * two branches rather than being written twice, and a shell that took it as a
 * slot would have to know which branch it was in to place it.
 */

import { Menu, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

const STORAGE_KEY = "mca.sidebar";

/**
 * Whether the sidebar was left closed, from the last time anyone said so.
 *
 * `localStorage` and not the account, for the reason `ThemeProvider` gives
 * about the theme: how much room the conversation gets is a property of the
 * screen someone is sitting at, not of who they are. The `catch` is not
 * defensive padding — a private window and blocked site data both *throw* here
 * rather than returning null, and a reader who cannot be remembered should
 * still get a working page.
 */
function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "closed";
  } catch {
    return false;
  }
}

/** Handed to the sidebar slot, because only the shell knows these exist. */
export interface SidebarControls {
  /** Closes the narrow-screen drawer once the reader has arrived somewhere. */
  onNavigate: () => void;
  /** Closes the wide-screen column. */
  onCollapse: () => void;
}

interface ChatShellProps {
  /**
   * Rendered in both places the sidebar appears. A slot rather than an element
   * because the callbacks above belong to this component — which is the whole
   * point of having lifted it here.
   */
  sidebar: (controls: SidebarControls) => ReactNode;
  /** Whatever belongs opposite the sidebar button: the account, the title. */
  controls: ReactNode;
  children: ReactNode;
}

export function ChatShell({ sidebar, controls, children }: ChatShellProps) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  const remember = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "closed" : "open");
    } catch {
      // The choice still applies to this page; it just will not outlive it.
    }
  };

  const slot: SidebarControls = {
    onNavigate: () => setDrawerOpen(false),
    onCollapse: () => remember(true),
  };

  return (
    <div className="flex h-full">
      {/* Not rendered at all when closed, rather than shrunk to a strip of
          icons: closed means gone, and the column takes the width.

          Both mounts get the same callbacks — closing a drawer that is not open
          costs nothing, and two call sites that differ for no nameable reason
          cost a reader more.

          No `bg-*` here, nor on the drawer. `ConversationSidebar` is `h-full`
          and paints itself, so both mounts get the same colour and `sheet.tsx`
          stays a drawer that knows nothing about what it is holding — it is
          also used in the styleguide with unrelated children. */}
      {!collapsed && (
        <aside className="hidden w-64 shrink-0 border-line border-r lg:block">
          {sidebar(slot)}
        </aside>
      )}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title={t("sidebar.title")}>
        {sidebar(slot)}
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* No rule under it and no fill of its own. The reference interfaces
            have no header bar at all: a button on one side, an avatar on the
            other, and the answer running to the top of the screen between them.
            `shrink-0` and a sibling of the scroller rather than inside it, so
            neither control ever passes over a line of the answer. */}
        <header className="flex shrink-0 items-center gap-snug px-gutter py-snug">
          {/* Two buttons, one per width, never both visible. On a phone the
              sidebar is a drawer and this opens it; from `lg` up the drawer
              does not exist and the button below brings the column back. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("sidebar.open")}
          >
            <Menu aria-hidden className="size-icon-lg" />
          </Button>
          {collapsed && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              onClick={() => remember(false)}
              aria-label={t("sidebar.expand")}
            >
              <PanelLeft aria-hidden className="size-icon-lg" />
            </Button>
          )}
          <div className="ml-auto">{controls}</div>
        </header>
        {children}
      </div>
    </div>
  );
}
