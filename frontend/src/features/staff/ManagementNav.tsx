/**
 * The chat sidebar's "Gestione" group: the staff pages an account may open,
 * between "Nuova conversazione" and the conversations (ConversationSidebar).
 *
 * Its items are landing.ts's. Each link closes the narrow-screen drawer as a
 * conversation link does, through the same `onNavigate`, so both mounts of the
 * sidebar behave alike. The item the reader is inside — on its page or any
 * page below it — is marked as the current one: `aria-current="page"` on its
 * own page, `"true"` below it, where the breadcrumb names the page itself
 * (outside the repository: WAI-ARIA 1.2, `aria-current`).
 */

import { BookOpen, GraduationCap, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";
import type { ManagementItem, ManagementKey } from "./landing";

const ICON: Record<ManagementKey, LucideIcon> = {
  programmes: GraduationCap,
  programme: GraduationCap,
  mine: BookOpen,
};

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
      <p className="px-tight pt-tight font-medium text-caption text-muted">{label}</p>
      {items.map((item) => {
        const Icon = ICON[item.key];
        const inside = item.within.some(
          (path) => pathname === path || pathname.startsWith(`${path}/`),
        );
        return (
          <Link
            key={item.key}
            to={item.to}
            onClick={onNavigate}
            aria-current={pathname === item.to ? "page" : inside ? "true" : undefined}
            className={cn(
              "flex items-center gap-tight rounded-md px-tight py-tight text-body transition-colors",
              inside ? "bg-mark font-medium text-ink" : "text-muted hover:bg-mark hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-icon shrink-0" />
            <span className="truncate">{t(`staff.nav.${item.key}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
