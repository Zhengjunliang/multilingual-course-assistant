/**
 * A list with nothing in it yet, said in its place: a dashed panel, a tinted
 * disc with a picture, a title and one sentence. No button: what would fill
 * the list is somewhere the reader can already reach.
 *
 * The picture is the caller's, the cat where a pose says what the emptiness
 * means (DESIGN.md, the pose table) and an icon elsewhere; it is decorative,
 * and the words say everything.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyProps {
  visual: ReactNode;
  heading: string;
  children: ReactNode;
  className?: string;
}

export function Empty({ visual, heading, children, className }: EmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-tight rounded-card border border-line border-dashed bg-surface px-gutter py-room text-center",
        className,
      )}
    >
      <span aria-hidden className="mb-hair rounded-full bg-accent-soft p-snug text-accent">
        {visual}
      </span>
      <p className="font-semibold text-body text-ink">{heading}</p>
      <p className="text-caption text-muted">{children}</p>
    </div>
  );
}
