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
    <div className="flex h-full min-h-0 flex-col gap-snug p-snug">
      {/* A link and not a button: "new conversation" is a place, so it should
          be openable in a new tab like any other. */}
      <NavLink
        to="/"
        end
        onClick={onNavigate}
        className="flex h-control w-full items-center justify-center gap-tight rounded-md border border-line bg-surface font-medium text-body text-ink transition-colors hover:bg-mark"
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
                        ? "bg-mark font-medium text-mark-ink"
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
