/**
 * Views of one page, one at a time: a programme's study plan and its
 * secretariat, a course's editions.
 *
 * Radix's tabs, as shadcn/ui builds its own: the WAI-ARIA tabs pattern
 * (outside the repository: WAI-ARIA APG, "Tabs Pattern"), the tab list one
 * stop with the arrow keys between the tabs, each tab tied to its panel. The
 * tabs are underlined rather than boxed, as GitHub's UnderlineNav is: the
 * selected one in ink over a 2 px rule in the accent, since the tab shown is
 * where the reader is, and its count in the accent too (#190, rules 3 and 5).
 *
 * Every panel stays mounted and the ones not shown are hidden (`forceMount`),
 * where Radix would unmount them: a filter typed into one tab is still there
 * when the reader comes back to it from another.
 *
 * `TabLinks` draws the same underline over views that are each an address,
 * a list's filter kept in its query: links in a `nav`, the one shown
 * `aria-current="page"`, as GitHub's issue list switches between open and
 * closed. Back and a link passed on both reopen the view.
 */

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Count } from "@/components/ui/count";
import { cn } from "@/lib/utils";

const LIST = "flex gap-hair overflow-x-auto shadow-[inset_0_-1px_var(--line)]";
const TAB =
  "group inline-flex h-control items-center gap-tight whitespace-nowrap border-transparent border-b-2 px-tight font-medium text-body text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2";

interface Tab<T extends string> {
  value: T;
  label: string;
  count?: number;
  content: ReactNode;
}

interface TabsProps<T extends string> {
  /** Names the tab list for a screen reader. */
  label: string;
  tabs: readonly Tab<T>[];
  /** The tab shown first; the tabs keep which one is shown after that. */
  defaultValue: T;
  className?: string;
}

export function Tabs<T extends string>({ label, tabs, defaultValue, className }: TabsProps<T>) {
  return (
    <RadixTabs.Root
      defaultValue={defaultValue}
      className={cn("flex flex-col gap-gutter", className)}
    >
      <RadixTabs.List aria-label={label} className={LIST}>
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(TAB, "data-[state=active]:border-accent data-[state=active]:text-ink")}
          >
            {tab.label}
            {tab.count !== undefined && (
              <Count
                value={tab.count}
                className="group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-ink"
              />
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content
          key={tab.value}
          value={tab.value}
          forceMount
          className="focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 data-[state=inactive]:hidden"
        >
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

interface TabLink {
  /** Where the view is: a path with its query. */
  to: string;
  label: string;
  count?: number;
  current: boolean;
}

interface TabLinksProps {
  /** Names the navigation for a screen reader. */
  label: string;
  links: readonly TabLink[];
}

export function TabLinks({ label, links }: TabLinksProps) {
  return (
    <nav aria-label={label} className={LIST}>
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          aria-current={link.current ? "page" : undefined}
          className={cn(TAB, "aria-[current=page]:border-accent aria-[current=page]:text-ink")}
        >
          {link.label}
          {link.count !== undefined && (
            <Count value={link.count} tone={link.current ? "accent" : "neutral"} />
          )}
        </Link>
      ))}
    </nav>
  );
}
