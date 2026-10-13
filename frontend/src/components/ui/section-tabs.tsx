/**
 * The numbered sections of one document, one shown at a time: a syllabus's
 * seven, as GitHub lists a repository's settings down the side.
 *
 * Radix's tabs, as `Tabs` builds its own (components/ui/tabs.tsx), with the
 * list vertical: one card, the sections down its side on the tint, each
 * numbered and with a caption under its name for its state, and the one shown
 * beside them. The shown one is `--selected` with the accent's bar at its
 * leading edge, as the sidebar marks where the reader is. Narrower than `xl`
 * the card has no room for both side by side, and the list runs across its
 * top, scrolling sideways; the arrow keys follow the line it is drawn on, up
 * and down or left and right (`aria-orientation`). What the sections share, a
 * setting, sits under the list (`foot`).
 *
 * Under the section shown, the one before it and the one after, to read them
 * in order as a guide's pages are. A step moves the focus to the section it
 * shows, whose name is then read out, so a step to the first or the last,
 * where a button goes, leaves the focus somewhere.
 *
 * Every panel stays mounted and the ones not shown are hidden (`forceMount`),
 * so a section half written is still there after a look at another.
 */

import * as RadixTabs from "@radix-ui/react-tabs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

/** Wide enough for the list to stand beside the section: Tailwind's `xl`. */
const WIDE = "(min-width: 80rem)";
const TAB =
  "group relative flex shrink-0 items-center gap-snug rounded-control px-snug py-tight text-left text-body text-ink transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 data-[state=active]:bg-selected data-[state=active]:hover:bg-selected before:absolute before:inset-y-tight before:left-0 before:rounded-r-full before:border-transparent before:border-l-(length:--spacing-bar) data-[state=active]:before:border-accent xl:w-full";
const NUMBER =
  "flex size-icon-lg shrink-0 items-center justify-center rounded-full border border-line bg-surface font-semibold text-caption text-muted tabular-nums group-data-[state=active]:border-accent group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-ink";

interface Section<T extends string> {
  value: T;
  label: string;
  /** Under the name: the state of the section, read after its name. */
  caption: string;
  content: ReactNode;
}

interface SectionTabsProps<T extends string> {
  /** Names the list for a screen reader. */
  label: string;
  sections: readonly Section<T>[];
  /** The section shown; the page keeps it. */
  value: T;
  onValueChange: (value: T) => void;
  /** Under the list: what the sections share. */
  foot?: ReactNode;
  /** The words before the names of the sections either side of the one shown. */
  steps: { previous: string; next: string };
  className?: string;
}

export function SectionTabs<T extends string>({
  label,
  sections,
  value,
  onValueChange,
  foot,
  steps,
  className,
}: SectionTabsProps<T>) {
  const wide = useMediaQuery(WIDE, false);
  const captionId = useId();
  const panels = useRef<HTMLDivElement>(null);
  const stepped = useRef(false);

  // After the render a step asked for, once the section it shows is shown.
  useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    panels.current?.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]')?.focus();
  });

  const at = sections.findIndex((section) => section.value === value);
  const before = sections[at - 1];
  const after = sections[at + 1];
  const step = (to: Section<T>) => {
    stepped.current = true;
    onValueChange(to.value);
  };

  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      orientation={wide ? "vertical" : "horizontal"}
      className={cn(
        "flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-raised xl:flex-row",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-tight border-hairline border-b bg-tint p-tight xl:w-64 xl:shrink-0 xl:border-r xl:border-b-0">
        <RadixTabs.List
          aria-label={label}
          className="flex gap-hair overflow-x-auto xl:flex-col xl:overflow-visible"
        >
          {sections.map((section, index) => (
            <RadixTabs.Trigger
              key={section.value}
              value={section.value}
              aria-describedby={`${captionId}-${index}`}
              className={TAB}
            >
              <span aria-hidden className={NUMBER}>
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="whitespace-nowrap font-medium group-data-[state=active]:font-semibold">
                  {section.label}
                </span>
                <span id={`${captionId}-${index}`} className="text-caption text-muted">
                  {section.caption}
                </span>
              </span>
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        {foot !== undefined && (
          <div className="border-hairline border-t px-tight pt-snug pb-tight">{foot}</div>
        )}
      </div>
      <div ref={panels} className="flex min-w-0 flex-1 flex-col">
        {sections.map((section) => (
          <RadixTabs.Content
            key={section.value}
            value={section.value}
            forceMount
            className="flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 data-[state=inactive]:hidden"
          >
            {section.content}
          </RadixTabs.Content>
        ))}
        <div className="flex flex-wrap items-center gap-tight border-hairline border-t px-gutter py-tight">
          {before !== undefined && (
            <Button type="button" variant="ghost" size="sm" onClick={() => step(before)}>
              <ChevronLeft aria-hidden className="size-icon" />
              <span className="sr-only">{`${steps.previous}: `}</span>
              {before.label}
            </Button>
          )}
          {after !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => step(after)}
            >
              <span className="sr-only">{`${steps.next}: `}</span>
              {after.label}
              <ChevronRight aria-hidden className="size-icon" />
            </Button>
          )}
        </div>
      </div>
    </RadixTabs.Root>
  );
}
