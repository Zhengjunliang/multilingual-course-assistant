/**
 * The sidebar folded on a wide screen: a 60 px rail of icons (#191), as
 * ChatGPT's and Gemini's sidebars fold, rather than nothing at all.
 *
 * From the top: the mark, which unfolds the sidebar; a new conversation; the
 * search, which unfolds the sidebar and puts the focus in its field, since a
 * search needs the list it searches; one icon per Gestione page, the current
 * one marked as the open sidebar marks it; and at the foot the avatar, whose
 * menu opens at its right. Each icon's hint gives its name and, where it has
 * one, its key (ui/tooltip.tsx), and the name is the icon's accessible name,
 * so the hint only repeats it (DESIGN.md, "Components").
 */

import { Search, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { AccountMenu } from "@/components/AccountMenu";
import { MascotMark } from "@/components/Mascot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ManagementItem } from "@/features/staff/landing";
import { currentness, ICON } from "@/features/staff/ManagementNav";
import { cn } from "@/lib/utils";
import type { SidebarControls } from "./ChatShell";
import { shortcuts } from "./shortcuts";

interface SidebarRailProps {
  controls: SidebarControls;
  /** The Gestione pages the account may open (features/staff/landing.ts). */
  items: readonly ManagementItem[];
}

const ICON_LINK = buttonVariants({ variant: "ghost", size: "icon" });

export function SidebarRail({ controls, items }: SidebarRailProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const keys = shortcuts();

  return (
    <nav
      aria-label={t("sidebar.title")}
      className="flex h-full flex-col items-center gap-hair bg-ground py-snug"
    >
      <Tooltip content={t("sidebar.expand")} side="right">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mb-tight size-control"
          aria-label={t("sidebar.expand")}
          onClick={controls.onExpand}
        >
          <MascotMark className="size-control-icon" />
        </Button>
      </Tooltip>
      <Tooltip content={t("sidebar.new")} shortcut={keys.newConversation} side="right">
        <Link to="/" aria-label={t("sidebar.new")} className={ICON_LINK}>
          <SquarePen aria-hidden className="size-icon-lg text-accent" />
        </Link>
      </Tooltip>
      <Tooltip content={t("sidebar.search")} shortcut={keys.search} side="right">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("sidebar.search")}
          onClick={controls.onSearch}
        >
          <Search aria-hidden className="size-icon-lg" />
        </Button>
      </Tooltip>
      {items.map((item) => {
        const Icon = ICON[item.key];
        const current = currentness(item, pathname);
        const label = t(`staff.nav.${item.key}`);
        return (
          <Tooltip key={item.key} content={label} side="right">
            <Link
              to={item.to}
              aria-label={label}
              aria-current={current}
              className={cn(ICON_LINK, current && "bg-selected text-accent hover:bg-selected")}
            >
              <Icon aria-hidden className="size-icon-lg" />
            </Link>
          </Tooltip>
        );
      })}
      <div className="mt-auto">
        <AccountMenu
          variant="avatar"
          onOpenSettings={controls.onOpenSettings}
          onOpenHelp={controls.onOpenHelp}
        />
      </div>
    </nav>
  );
}
