/**
 * The frame of every signed-in page, the chat and the staff pages alike
 * (routes/ShellLayout.tsx renders it): the sidebar, its rail when folded, its
 * narrow-screen drawer, the row above the page, the two dialogs the account
 * menu opens, and the four keys that work from anywhere (#191).
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
 *
 * Folded, the sidebar is a rail of icons rather than nothing, as ChatGPT's and
 * Gemini's are: the new conversation, the search, the Gestione pages and the
 * account stay one click away, and the conversation gets the width. Below
 * `lg` the same panel is a drawer, opened from the row above the page, which
 * gets the focus back when the drawer closes.
 */

import { Menu } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsDialog } from "@/components/SettingsDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useShellShortcuts } from "./useShellShortcuts";

const STORAGE_KEY = "mca.sidebar";

/** Tailwind's `lg`, from which the sidebar is a column rather than a drawer. */
const WIDE = "(min-width: 64rem)";

/**
 * Whether the sidebar was left folded, from the last time anyone said so.
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

/** Handed to the sidebar and rail slots, because only the shell knows these exist. */
export interface SidebarControls {
  /** The column on a wide screen, or the drawer below `lg`. */
  placement: "column" | "drawer";
  /** Closes the narrow-screen drawer once the reader has arrived somewhere. */
  onNavigate: () => void;
  /** Folds the wide-screen column into its rail. */
  onCollapse: () => void;
  /** Unfolds the rail into the column. */
  onExpand: () => void;
  /** Closes the drawer from its own button. */
  onClose: () => void;
  /** Unfolds the column, or opens the drawer, and puts the focus in the search. */
  onSearch: () => void;
  /** The search field of this mount, which `onSearch` and Ctrl K focus. */
  searchRef: RefObject<HTMLInputElement | null>;
  /** The shell's two dialogs, which the account menu opens. */
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

interface ChatShellProps {
  /**
   * Rendered in both places the sidebar appears. A slot rather than an element
   * because the callbacks above belong to this component — which is the whole
   * point of having lifted it here.
   */
  sidebar: (controls: SidebarControls) => ReactNode;
  /** The folded sidebar, on a wide screen. */
  rail: (controls: SidebarControls) => ReactNode;
  /** Ctrl ⇧ O: the layout owns the address, so it starts the conversation. */
  onNewConversation: () => void;
  /** Beside the drawer's button: where the page sits, such as a staff page's breadcrumb. */
  leading?: ReactNode;
  children: ReactNode;
}

export function ChatShell({ sidebar, rail, onNewConversation, leading, children }: ChatShellProps) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  // The settings and the list of shortcuts, opened from the account menu in
  // any mount of the sidebar and from the keys; they live here, once.
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  // Where the focus was when a dialog opened, to give it back on closing:
  // Radix returns it only to a `Trigger` of the dialog's own, and these open
  // from state. Read in a layout effect, which runs before the dialog's own
  // effects move the focus inside it, and after the account menu has given
  // the focus back to its row (AccountMenu.tsx says why it waits).
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (dialog === null) return;
    returnTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [dialog]);

  // The search field of each mount, and which one was asked for. The column
  // may first have to unfold, so its field gets the focus once the render that
  // shows it has happened; the drawer's gets it as the drawer opens, in place
  // of the drawer's first control (`onOpenAutoFocus` below).
  const columnSearch = useRef<HTMLInputElement>(null);
  const drawerSearch = useRef<HTMLInputElement>(null);
  const searchWanted = useRef<"column" | "drawer" | null>(null);
  const [searchAsked, setSearchAsked] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: both are when to look again, not what is read
  useEffect(() => {
    if (searchWanted.current !== "column" || columnSearch.current === null) return;
    searchWanted.current = null;
    columnSearch.current.focus();
  }, [searchAsked, collapsed]);

  const remember = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "closed" : "open");
    } catch {
      // The choice still applies to this page; it just will not outlive it.
    }
  };

  const search = () => {
    if (window.matchMedia(WIDE).matches) {
      if (collapsed) remember(false);
      searchWanted.current = "column";
    } else {
      setDrawerOpen(true);
      searchWanted.current = "drawer";
    }
    setSearchAsked((asked) => asked + 1);
  };

  const controls = (placement: SidebarControls["placement"]): SidebarControls => ({
    placement,
    onNavigate: () => setDrawerOpen(false),
    onCollapse: () => remember(true),
    onExpand: () => remember(false),
    onClose: () => setDrawerOpen(false),
    onSearch: search,
    searchRef: placement === "drawer" ? drawerSearch : columnSearch,
    onOpenSettings: () => setDialog("settings"),
    onOpenHelp: () => setDialog("help"),
  });

  useShellShortcuts({
    newConversation: () => {
      setDrawerOpen(false);
      onNewConversation();
    },
    search,
    settings: () => setDialog("settings"),
    help: () => setDialog("help"),
  });

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const giveFocusBack = (event: Event) => {
    event.preventDefault();
    if (returnTo.current?.isConnected) returnTo.current.focus();
  };

  return (
    <div className="flex h-full">
      {/* From `lg` up, the column or, folded, its rail; below `lg`, neither,
          and the drawer is the sidebar. No `bg-*` here, nor on the drawer: the
          panel paints its own ground (ConversationSidebar.tsx), so both
          mounts look the same and `sheet.tsx` stays a drawer that knows
          nothing about what it is holding. */}
      <aside
        className={cn(
          "hidden shrink-0 border-line border-r lg:block",
          collapsed ? "w-rail" : "w-sidebar",
        )}
      >
        {collapsed ? rail(controls("column")) : sidebar(controls("column"))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* No rule under it and no fill of its own. The reference interfaces
            have no header bar at all: the account is at the sidebar's foot, and
            the answer runs to the top of the screen beside where the reader is.
            `shrink-0` and a sibling of the scroller rather than inside it, so
            no control ever passes over a line of the answer. */}
        <header className="flex shrink-0 items-center gap-snug px-gutter py-snug">
          {/* The drawer's own trigger, so it gets the focus back when the
              drawer closes; from `lg` up the drawer does not exist. */}
          <Sheet
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            heading={t("sidebar.title")}
            onOpenAutoFocus={(event) => {
              if (searchWanted.current !== "drawer") return;
              searchWanted.current = null;
              event.preventDefault();
              drawerSearch.current?.focus();
            }}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label={t("sidebar.open")}
              >
                <Menu aria-hidden className="size-icon-lg" />
              </Button>
            }
          >
            {sidebar(controls("drawer"))}
          </Sheet>
          <div className="min-w-0 flex-1">{leading}</div>
        </header>
        {children}
      </div>
      <SettingsDialog
        open={dialog === "settings"}
        onOpenChange={closeDialog}
        onCloseAutoFocus={giveFocusBack}
      />
      <ShortcutsDialog
        open={dialog === "help"}
        onOpenChange={closeDialog}
        onCloseAutoFocus={giveFocusBack}
      />
    </div>
  );
}
