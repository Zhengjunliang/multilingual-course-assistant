/**
 * Where a page sits: the pages above it, each a link, then the page itself.
 *
 * A `nav` with its own label and an ordered list, the last item marked
 * `aria-current="page"` and not a link (outside the repository: WAI-ARIA APG,
 * "Breadcrumb Pattern"). Each separator is an icon inside the crumb it
 * precedes, hidden from assistive technology, so a screen reader hears a list
 * of pages and nothing between them. Links go through the router: a crumb
 * never reloads the page.
 */

import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface Crumb {
  label: string;
  /** Absent on the page itself, the last crumb. */
  to?: string;
}

interface BreadcrumbProps {
  /** Names the navigation for a screen reader, such as "Percorso". */
  label: string;
  crumbs: readonly Crumb[];
}

export function Breadcrumb({ label, crumbs }: BreadcrumbProps) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-hair text-caption text-muted">
        {crumbs.map((crumb, index) => (
          <li key={crumb.to ?? crumb.label} className="flex min-w-0 items-center gap-hair">
            {index > 0 && <ChevronRight aria-hidden className="size-icon shrink-0" />}
            {crumb.to === undefined ? (
              <span aria-current="page" className="truncate font-medium text-ink">
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.to}
                className="rounded-md hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
