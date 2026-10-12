/**
 * A panel on the page: surface, a hairline border, raised a step.
 *
 * A card that says what it is has a head (`CardHeader`): an icon in a tinted
 * disc, a two-line title, what matters in ink and what supports it below in
 * muted, and a chip or a count at its end (#190, rule 1). Its foot
 * (`CardFooter`) sits on `--tint` behind a hairline, so it reads as part of
 * the card rather than as a second one (rule 4). What lies between is the
 * page's own, with its padding.
 *
 * A card that opens something, `interactive`, answers the pointer: it lifts
 * a pixel, takes the accent's hairline and floats as an overlay does. The
 * lift is the only motion, and reduced motion keeps the card in place.
 */

import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Card({
  interactive = false,
  className,
  ...props
}: ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-surface shadow-raised",
        interactive &&
          "transition-[translate,box-shadow,border-color] hover:border-accent-line hover:shadow-overlay focus-within:border-accent-line motion-safe:hover:-translate-y-px",
        className,
      )}
      {...props}
    />
  );
}

interface CardHeaderProps {
  icon?: LucideIcon;
  heading: ReactNode;
  /** The second line: a code, a count of what the card holds. */
  caption?: ReactNode;
  /** At the end of the head: a chip or a count. */
  aside?: ReactNode;
  /** The heading's level in the page's outline. */
  level?: 2 | 3;
  className?: string;
}

export function CardHeader({
  icon: Icon,
  heading,
  caption,
  aside,
  level = 3,
  className,
}: CardHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("flex items-center gap-snug px-gutter py-snug", className)}>
      {Icon !== undefined && (
        <span className="grid size-control-sm shrink-0 place-items-center rounded-control bg-accent-soft text-accent ring-1 ring-accent-line ring-inset">
          <Icon aria-hidden className="size-icon" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Heading className="truncate font-semibold text-body text-ink">{heading}</Heading>
        {caption !== undefined && <p className="truncate text-caption text-muted">{caption}</p>}
      </div>
      {aside}
    </div>
  );
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-tight rounded-b-card border-hairline border-t bg-tint px-gutter py-tight",
        className,
      )}
      {...props}
    />
  );
}
