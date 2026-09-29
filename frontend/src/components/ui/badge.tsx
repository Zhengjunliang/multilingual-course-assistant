/**
 * A word that marks a state, such as the current edition of a course.
 *
 * Text, not a coloured dot: the state has to read the same without colour, and
 * this palette has no hue to spend on it. The fill is `--mark` with ink, the
 * pill a citation wears in an answer, so the interface keeps one way of setting
 * a short word apart.
 */

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md bg-mark px-tight py-hair font-medium text-caption text-ink",
        className,
      )}
      {...props}
    />
  );
}
