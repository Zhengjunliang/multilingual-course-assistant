import { MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import type { ConversationSummary } from "@/api/conversations";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  conversations: readonly ConversationSummary[];
  /** Called after navigation so the narrow-screen drawer can close itself. */
  onNavigate?: () => void;
}

export function ConversationSidebar({ conversations, onNavigate }: ConversationSidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {/* A link and not a button: "new conversation" is a place, so it should
          be openable in a new tab like any other. */}
      <NavLink
        to="/"
        end
        onClick={onNavigate}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface font-medium text-ink text-sm transition-colors hover:bg-mark"
      >
        <MessageSquarePlus aria-hidden className="h-4 w-4" />
        {t("sidebar.new")}
      </NavLink>

      <nav className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-muted text-sm">{t("sidebar.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <NavLink
                  to={`/c/${conversation.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "block truncate rounded-md px-2 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-mark text-mark-ink"
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
