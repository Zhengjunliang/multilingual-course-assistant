/**
 * A line of what is still on its way, in its shape: the rows of a list
 * before the server has answered, so the empty state is never shown for a
 * list that is only loading (#191).
 *
 * `--mark` on the ground, pulsing slowly where motion is allowed and still
 * where it is not. Hidden from assistive technology: the list it stands in
 * for says it is busy.
 */

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-tight rounded-full bg-mark motion-safe:animate-pulse", className)}
    />
  );
}
