/**
 * What a screen shows when it has nothing of its own to show: the address
 * names no page, or the page broke while it was drawn. The cat in the pose
 * for it, a heading, one sentence, and the ways on.
 *
 * One panel for every such screen, so a reader meets one face and one tone
 * whichever went wrong (DESIGN.md, "Components"). It holds no state and reads
 * no provider, so the outermost crash screen (AppCrash.tsx), drawn when a
 * provider itself has failed, can use it too.
 *
 * `alert` turns the words into a live region. An error replaces the page the
 * reader was looking at, and a screen reader must say that it did; a page
 * that is not found is the page the reader asked for, and is read as one.
 */

import type { ReactNode } from "react";

import type { Pose } from "@/brand/fumetto";
import { Mascot } from "@/components/Mascot";

interface StatusPanelProps {
  pose: Pose;
  heading: string;
  body: string;
  /** Announces the words as they appear, for an error that replaced a page. */
  alert?: boolean;
  /** The ways on, as links or buttons. */
  children: ReactNode;
}

export function StatusPanel({ pose, heading, body, alert = false, children }: StatusPanelProps) {
  return (
    <div data-status-panel className="flex flex-col items-center gap-room text-center">
      <Mascot pose={pose} className="size-mascot" />
      <div role={alert ? "alert" : undefined} className="flex max-w-sm flex-col gap-hair">
        <h1 className="font-semibold font-serif text-display text-ink">{heading}</h1>
        <p className="text-body text-muted">{body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-tight">{children}</div>
    </div>
  );
}
