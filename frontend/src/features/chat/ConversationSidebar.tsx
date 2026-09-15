import { MessageSquarePlus, PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import type { ConversationSummary } from "@/api/conversations";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  conversations: readonly ConversationSummary[];
  /** Called after navigation so the narrow-screen drawer can close itself. */
  onNavigate?: () => void;
  /** Closes the wide-screen column. Absent on narrow screens, where the drawer wins. */
  onCollapse?: () => void;
}

export function ConversationSidebar({
  conversations,
  onNavigate,
  onCollapse,
}: ConversationSidebarProps) {
  const { t } = useTranslation();

  return (
    // Its own colour, and the reason is that it is rendered in two places: the
    // fixed column on a wide screen and the drawer on a narrow one. Painting
    // the containers instead would mean painting two of them, and one of those
    // is a generic drawer that also holds unrelated things.
    <div className="flex h-full min-h-0 flex-col gap-snug bg-sidebar p-snug">
      {/* The name of the application lives here now. There is no header bar to
          hold it, which is the trade the reference interfaces make: the title
          is where the product's own furniture is, and the reading column starts
          at the top of the screen. */}
      <div className="flex items-center gap-tight">
        <p className="min-w-0 flex-1 truncate px-tight py-tight font-semibold text-ink text-title">
          {t("app.title")}
        </p>
        {/* Only from `lg` up: below that the sidebar is a drawer, and a drawer
            already closes by tapping outside it or pressing Escape. */}
        {onCollapse !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden shrink-0 lg:inline-flex"
            onClick={onCollapse}
            aria-label={t("sidebar.collapse")}
          >
            <PanelLeft aria-hidden className="size-icon-lg" />
          </Button>
        )}
      </div>

      {/* A link and not a button: "new conversation" is a place, so it should
          be openable in a new tab like any other.

          No fill of its own. On this palette `--surface` is *darker* than
          `--sidebar` in the dark theme, so a filled button here would read as a
          dent rather than a control. The border carries it, and the hover fill
          is the same `--mark` the conversation rows use. */}
      <NavLink
        to="/"
        end
        onClick={onNavigate}
        className="flex h-control w-full items-center justify-center gap-tight rounded-md border border-line font-medium text-body text-ink transition-colors hover:bg-mark"
      >
        <MessageSquarePlus aria-hidden className="size-icon" />
        {t("sidebar.new")}
      </NavLink>

      <nav className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-tight py-gutter text-body text-muted">{t("sidebar.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-hair">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <NavLink
                  to={`/c/${conversation.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "block truncate rounded-md px-tight py-tight text-body transition-colors",
                      // The open conversation is where the reader *is*, not
                      // something they are about to do: ink and a quiet fill,
                      // the same rule the language switch follows.
                      isActive
                        ? "bg-mark font-medium text-ink"
                        : "text-muted hover:bg-mark hover:text-ink",
                    )
                  }
                >
                  {conversation.title || t("sidebar.untitled")}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
