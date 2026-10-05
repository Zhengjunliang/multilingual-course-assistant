/**
 * A data table: the native elements, named by a caption.
 *
 * Native `<table>` markup rather than a grid of `div`s with ARIA roles, since
 * the browser then gives a screen reader the rows, columns and headers itself
 * (outside the repository: WAI-ARIA APG, "Table Pattern"); the caption is what
 * the table is called. A wide table scrolls inside its own frame, so a phone's
 * page never scrolls sideways; a table whose headers stick to the top of the
 * page lets that frame go where the screen is wide enough (`frameClassName`),
 * since a sticky cell sticks to the nearest frame that scrolls. A row under the
 * pointer wears `--mark`, the same quiet fill as everywhere else something can
 * be acted on.
 */

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Table({
  className,
  frameClassName,
  ...props
}: ComponentProps<"table"> & { frameClassName?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", frameClassName)}>
      <table className={cn("w-full border-collapse text-body", className)} {...props} />
    </div>
  );
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      className={cn("pb-tight text-left font-medium text-body text-ink", className)}
      {...props}
    />
  );
}

export function TableHeader(props: ComponentProps<"thead">) {
  return <thead {...props} />;
}

export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-line border-b transition-colors hover:bg-mark", className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-tight py-tight text-left font-medium text-caption text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-tight py-tight align-middle text-ink", className)} {...props} />;
}
