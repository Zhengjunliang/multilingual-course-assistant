/**
 * A notice across the width of what it is about, with a way on: a page the
 * reader may see but not change, an answer that was interrupted.
 *
 * Two tones. `info` is the accent's tint and hairline; `warn` the warning's,
 * for a failure only. Its title says what holds, in ink, and a sentence under
 * it says why or what follows, in muted (#190, rule 1). Its icon is the
 * tone's ink, and the words carry the meaning without it.
 *
 * `role` is the caller's: a notice that must interrupt is an `alert`, which a
 * screen reader announces as it appears. One that only informs is said through
 * a `status` region already on the page (features/chat/notice.ts): a status
 * inserted with its words in it is not reliably announced. One that is part of
 * the page as it opens is read with the page and needs neither.
 */

import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface BannerProps {
  tone?: "info" | "warn";
  /** A Lucide icon, or the `Spinner` for a notice about something on its way. */
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  heading: string;
  children?: ReactNode;
  /** A button or a link at the end. */
  action?: ReactNode;
  role?: "alert";
  className?: string;
}

export function Banner({
  tone = "info",
  icon: Icon,
  heading,
  children,
  action,
  role,
  className,
}: BannerProps) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-wrap items-center gap-snug rounded-control border px-snug py-tight",
        tone === "warn" ? "border-warn-line bg-warn" : "border-accent-line bg-accent-soft",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-icon-lg shrink-0", tone === "warn" ? "text-warn-ink" : "text-accent")}
      />
      <div className="flex min-w-0 flex-1 basis-56 flex-col">
        <p className="font-semibold text-body text-ink">{heading}</p>
        {children !== undefined && <p className="text-caption text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}
