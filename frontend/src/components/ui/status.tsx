/**
 * The line that says what the last action did: "mrossi added", "2025-2026 is
 * now current".
 *
 * `role="status"`, a polite live region (outside the repository: MDN, ARIA
 * `status` role): a screen reader reads a change of its text when it is next
 * idle, without moving focus. The region is on the page before anything is
 * said in it, empty, because a live region inserted together with its text is
 * one some screen readers never announce. It is visible too: the result is
 * news for a sighted reader as much as for anyone, and it stays until the next
 * one replaces it, with no toast that vanishes before it is read.
 */

import { cn } from "@/lib/utils";

interface StatusProps {
  /** Empty until there is something to say. */
  message: string;
  className?: string;
}

export function Status({ message, className }: StatusProps) {
  return (
    <p
      role="status"
      className={cn("min-h-(--text-body--line-height) text-body text-muted", className)}
    >
      {message}
    </p>
  );
}
