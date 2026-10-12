/**
 * One of a few options, chosen in place: a theme, a year of a study plan.
 *
 * Radix's toggle group in its single mode, as shadcn/ui builds its own: one
 * stop in the tab order and the arrow keys between the options, each a radio
 * with `aria-checked`, which a hand-rolled row of buttons gets wrong
 * (dropdown-menu.tsx says why this layer takes such parts from Radix). Radix
 * lets a pressed option be pressed again to leave none chosen; a setting
 * always has a value, so that press is ignored.
 *
 * The chosen option is raised out of a tinted track, in ink, the way a
 * segmented control is drawn, and never in the accent: what it shows is a
 * setting that is true, not where the reader is (DESIGN.md, Do's and
 * Don'ts). An option may carry a count, such as the courses of each year.
 */

import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import type { LucideIcon } from "lucide-react";

import { Count } from "@/components/ui/count";
import { cn } from "@/lib/utils";

interface ToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

interface ToggleGroupProps<T extends string> {
  /** Names the group for a screen reader, such as "Aspetto". */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly ToggleOption<T>[];
  className?: string;
}

export function ToggleGroup<T extends string>({
  label,
  value,
  onValueChange,
  options,
  className,
}: ToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen !== undefined) onValueChange(chosen.value);
      }}
      className={cn(
        "inline-flex flex-wrap gap-px rounded-control border border-line bg-tint p-px",
        className,
      )}
    >
      {options.map((option) => (
        <RadixToggleGroup.Item
          key={option.value}
          value={option.value}
          className="inline-flex h-control-xs items-center gap-tight whitespace-nowrap rounded-chip px-tight font-medium text-body text-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 data-[state=on]:bg-surface data-[state=on]:font-semibold data-[state=on]:text-ink data-[state=on]:shadow-raised"
        >
          {option.icon !== undefined && <option.icon aria-hidden className="size-icon shrink-0" />}
          {option.label}
          {option.count !== undefined && <Count value={option.count} />}
        </RadixToggleGroup.Item>
      ))}
    </RadixToggleGroup.Root>
  );
}
