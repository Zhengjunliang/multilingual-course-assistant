/**
 * One entry of the catalogue (routes/StyleguidePage.tsx): the component's
 * name, as its test looks for it, a line on how it is used, and the specimen.
 */

import type { ReactNode } from "react";

export type Theme = "light" | "dark";

export function Specimen({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-tight border-line border-t pt-snug first:border-t-0 first:pt-0">
      <h3 className="font-medium font-mono text-caption text-ink">{name}</h3>
      <p className="text-caption text-muted">{note}</p>
      {children !== undefined && (
        <div className="flex flex-wrap items-end gap-tight">{children}</div>
      )}
    </section>
  );
}
