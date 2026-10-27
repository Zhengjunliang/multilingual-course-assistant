/**
 * What a screen shows when it has nothing of its own to show: the address
 * names no page, or the page broke while it was drawn. One centred panel
 * (#190): the cat in the pose for it, or an icon where the screen is a staff
 * object that cannot be read (#194: a lock, the page is out of reach rather
 * than lost), in a tinted disc, the warning's when something broke; a chip
 * with the code, where there is one (404); a heading, one sentence, the
 * reference of a failure the reader can only report in small print, and a
 * primary and a secondary way on. A page that broke may fold the error's
 * technical details under them, for whoever reports it, closed until asked
 * for.
 *
 * One panel for every such screen, so a reader meets one face and one tone
 * whichever went wrong (DESIGN.md, "Components"). It holds no state and reads
 * no provider, so the outermost crash screen (AppCrash.tsx), drawn when a
 * provider itself has failed, can use it too; that is also why the details'
 * label is the caller's.
 *
 * The cat stays in the accent's line on the warning's disc: its colours are
 * fixed (frontend/brand/README.md), the ground behind it is not. An icon
 * takes the disc's ink.
 *
 * The heading takes focus when asked (`tabIndex={-1}`): when a dialog's
 * request finds its object gone, the page reads again into this panel, and
 * the focus the dialog hands back lands on the heading (features/staff/actions.tsx).
 *
 * `alert` turns the words into a live region. An error replaces the page the
 * reader was looking at, and a screen reader must say that it did; a page
 * that is not found is the page the reader asked for, and is read as one.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Pose } from "@/brand/fumetto";
import { Mascot } from "@/components/Mascot";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

/** The disc's picture: the cat in a pose, or an icon. */
type Visual = { pose: Pose; icon?: undefined } | { icon: LucideIcon; pose?: undefined };

type StatusPanelProps = Visual & {
  heading: string;
  body: string;
  /** A status code shown on a chip, such as "404". */
  code?: string;
  /**
   * For a failure the reader can only report: its code and request id, in
   * `text-caption` and `muted` under the sentence, outside the live region
   * (lib/errorText.ts).
   */
  reference?: string;
  /** `warn` when something broke. */
  tone?: "accent" | "warn";
  /** The error, folded under a summary the caller names. */
  details?: { label: string; text: string };
  /** Announces the words as they appear, for an error that replaced a page. */
  alert?: boolean;
  /** The ways on, as links or buttons, the primary first. */
  children: ReactNode;
};

export function StatusPanel({
  pose,
  icon: Icon,
  heading,
  body,
  code,
  reference,
  tone = "accent",
  details,
  alert = false,
  children,
}: StatusPanelProps) {
  return (
    <div
      data-status-panel
      className="flex w-full max-w-md flex-col items-center gap-snug rounded-card border border-line bg-surface p-room text-center shadow-raised"
    >
      <span
        className={cn(
          "grid size-mascot place-items-center rounded-full p-gutter ring-1 ring-inset",
          tone === "warn" ? "bg-warn ring-warn-line" : "bg-accent-soft ring-accent-line",
        )}
      >
        {pose !== undefined ? (
          <Mascot pose={pose} className="size-full" />
        ) : (
          Icon !== undefined && (
            <Icon
              aria-hidden
              className={cn("size-icon-xl", tone === "warn" ? "text-warn-ink" : "text-accent")}
            />
          )
        )}
      </span>
      {code !== undefined && <Chip>{code}</Chip>}
      <div role={alert ? "alert" : undefined} className="flex flex-col gap-hair">
        <h1 tabIndex={-1} className="font-semibold text-display text-ink outline-none">
          {heading}
        </h1>
        <p className="text-body text-muted">{body}</p>
      </div>
      {reference !== undefined && <p className="text-caption text-muted">{reference}</p>}
      <div className="mt-tight flex flex-wrap justify-center gap-tight">{children}</div>
      {details !== undefined && (
        <details className="w-full rounded-control border border-line border-dashed px-snug py-tight text-left text-caption text-muted">
          <summary className="cursor-pointer">{details.label}</summary>
          <pre className="mt-tight overflow-x-auto whitespace-pre-wrap font-mono text-caption text-ink">
            {details.text}
          </pre>
        </details>
      )}
    </div>
  );
}
