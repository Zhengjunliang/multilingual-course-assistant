/**
 * A word that marks a state, such as the current edition of a course.
 *
 * Text, not a coloured dot: the state has to read the same without colour. The
 * fill is `--accent-soft` with the accent as ink, the pair that says "this is
 * the current one" wherever a reader is shown where they are, and not `--mark`,
 * which a citation pill wears to say it can be clicked.
 */

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-chip bg-accent-soft px-tight py-hair font-medium text-accent text-caption",
        className,
      )}
      {...props}
    />
  );
}
