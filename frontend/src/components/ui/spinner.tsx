/**
 * A ring that turns while something is on its way: a button's own request
 * (`button.tsx`, `pending`), a form being sent.
 *
 * Always beside words that say what is happening, which is why it is hidden
 * from assistive technology and why it may stand still: under reduced motion
 * it does (`spinner` in index.css), and the words still say it.
 */

import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "spinner inline-block size-icon shrink-0 rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
}
