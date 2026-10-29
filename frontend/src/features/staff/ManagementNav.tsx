/**
 * The chat sidebar's "Gestione" group: the staff pages an account may open,
 * between the search field and the conversations (ConversationSidebar).
 *
 * Its items are landing.ts's, each with the count of what its page lists, but
 * the accounts, which only their own page counts.
 * Each link closes the narrow-screen drawer as a conversation link does,
 * through the same `onNavigate`, so both mounts of the sidebar behave alike.
 * The item the reader is inside — on its page or any page below it — is drawn
 * as the open conversation is (features/chat/rows.ts) and marked as the
 * current one: `aria-current="page"` on its own page, `"true"` below it, where
 * the breadcrumb names the page itself (outside the repository: WAI-ARIA 1.2,
 * `aria-current`). `ICON` is exported for the folded rail, which shows the
 * same items as icons.
 */

import { BookOpen, GraduationCap, type LucideIcon, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { Count } from "@/components/ui/count";
import { SIDEBAR_ROW, SIDEBAR_ROW_CURRENT } from "@/features/chat/rows";
import { cn } from "@/lib/utils";
import type { ManagementItem, ManagementKey } from "./landing";

export const ICON: Record<ManagementKey, LucideIcon> = {
  programmes: GraduationCap,
  programme: GraduationCap,
  mine: BookOpen,
  users: UsersRound,
};

/** Where the reader stands relative to an item, as `aria-current` says it. */
export function currentness(item: ManagementItem, pathname: string): "page" | "true" | undefined {
  if (pathname === item.to) return "page";
  const inside = item.within.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return inside ? "true" : undefined;
}

interface ManagementNavProps {
  items: readonly ManagementItem[];
  onNavigate?: () => void;
}

export function ManagementNav({ items, onNavigate }: ManagementNavProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const label = t("staff.nav.management");

  return (
    <nav aria-label={label} className="flex flex-col gap-hair">
      <h2 className="px-tight pt-hair font-semibold text-body text-ink">{label}</h2>
      <ul className="flex flex-col gap-hair">
        {items.map((item) => {
          const Icon = ICON[item.key];
          const current = currentness(item, pathname);
          return (
            <li key={item.key}>
              <Link
                to={item.to}
                onClick={onNavigate}
                aria-current={current}
                className={cn(SIDEBAR_ROW, current && SIDEBAR_ROW_CURRENT)}
              >
                <Icon
                  aria-hidden
                  className={cn("size-icon shrink-0", current ? "text-accent" : "text-muted")}
                />
                <span className="min-w-0 flex-1 truncate">{t(`staff.nav.${item.key}`)}</span>
                {item.count !== null && <Count value={item.count} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
