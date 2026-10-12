/**
 * A state named in words, with a dot before them: filled in the accent when
 * it holds ("Corrente"), an empty ring when it does not ("Non corrente").
 *
 * The words carry the state and the dot repeats it, so it reads the same
 * without colour; the dot is hidden from assistive technology.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface StatusDotProps {
  on: boolean;
  children: ReactNode;
  className?: string;
}

export function StatusDot({ on, children, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-tight whitespace-nowrap text-body text-ink",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-tight shrink-0 rounded-full", on ? "bg-accent" : "border border-muted")}
      />
      {children}
    </span>
  );
}
