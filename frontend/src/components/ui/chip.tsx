/**
 * A short piece of data in a fill: a code, a year, a role, a state, a
 * language (#190, rule 2: a label has a fill).
 *
 * A tint with a hairline edge, in three tones. `accent` is for the current
 * state, a role or a source; `neutral` for a code, a kind or a language;
 * `warn` for a failure and nothing else. `Badge` stays for markers, words
 * that point at something rather than data about it; a chip is data. `sm`
 * is for a language code beside a name.
 *
 * Text, so it reads the same without colour.
 */

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const chipVariants = cva(
  "inline-flex shrink-0 items-center gap-hair whitespace-nowrap rounded-chip border font-medium text-caption tabular-nums",
  {
    variants: {
      tone: {
        accent: "border-accent-line bg-accent-soft text-accent",
        neutral: "border-line bg-mark text-ink",
        warn: "border-warn-line bg-warn text-warn-ink",
      },
      size: {
        default: "h-icon-lg px-tight",
        sm: "h-icon px-hair leading-none",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  },
);

export function Chip({
  tone,
  size,
  className,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return <span className={cn(chipVariants({ tone, size }), className)} {...props} />;
}
