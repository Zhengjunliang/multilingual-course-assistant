/**
 * How many: beside a group's title, in a tab, in a filter (#190, rule 5).
 *
 * A round pill, so a quantity never reads as a chip's data. `accent` marks
 * the count of where the reader is, the selected tab's. The figures are
 * tabular, so a count that changes does not shift what follows it.
 */

import { cn } from "@/lib/utils";

interface CountProps {
  value: number;
  tone?: "neutral" | "accent";
  className?: string;
}

export function Count({ value, tone = "neutral", className }: CountProps) {
  return (
    <span
      className={cn(
        "inline-flex h-icon-lg min-w-icon-lg shrink-0 items-center justify-center rounded-full px-hair font-semibold text-caption tabular-nums",
        tone === "accent" ? "bg-accent text-accent-ink" : "bg-mark text-muted",
        className,
      )}
    >
      {value}
    </span>
  );
}
