/**
 * The chips that offer a reader something to ask before they have typed.
 *
 * Ported from Vercel's AI Elements `suggestion` (Copyright 2023 Vercel, Inc.,
 * Apache-2.0) rather than written from scratch, so the shape of the thing comes
 * from the same standard as the rest of this layer. Two changes were made on
 * the way in, both forced by this repository:
 *
 *  - upstream wraps the row in a Radix `ScrollArea`, purely to get a horizontal
 *    strip without a visible scrollbar. That is a dependency for a problem
 *    CitationList.tsx already solves with `overflow-x-auto`, and a second way
 *    to scroll a row sideways is a second thing to keep consistent;
 *  - upstream's classes name Tailwind's default palette. Here they name this
 *    project's semantic tokens, which is what keeps a component from being
 *    right in one theme and wrong in the other.
 */

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SuggestionsProps = ComponentProps<"div">;

export function Suggestions({ className, children, ...props }: SuggestionsProps) {
  return (
    <div className={cn("w-full overflow-x-auto", className)} {...props}>
      {/* `w-max` so the row keeps its natural width and scrolls, rather than
          wrapping the chips onto a second line that pushes the composer down. */}
      <div className="flex w-max flex-nowrap items-center gap-tight pb-hair">{children}</div>
    </div>
  );
}

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export function Suggestion({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) {
  return (
    <Button
      className={cn("rounded-full px-gutter", className)}
      onClick={() => onClick?.(suggestion)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children ?? suggestion}
    </Button>
  );
}
