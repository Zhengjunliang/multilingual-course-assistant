/**
 * Where a page sits: the pages above it, then the page itself.
 *
 * A `nav` with its own label and an ordered list, the last item marked
 * `aria-current="page"` and not a link (outside the repository: WAI-ARIA APG,
 * "Breadcrumb Pattern"). A crumb above it with no page to go to — a
 * secretariat's "Corso di laurea", which has no list behind it — is plain
 * text, never the current page. Each separator is an icon inside the crumb it
 * precedes, hidden from assistive technology, so a screen reader hears a list
 * of pages and nothing between them. Links go through the router: a crumb
 * never reloads the page.
 *
 * The area the pages belong to may lead it, its icon in a tinted disc, as the
 * sidebar draws that area's item; decorative, since the first crumb names it,
 * and left out on a phone, where the header has no room for it. The crumbs
 * are body text, the page itself at 600 (DESIGN.md, rule 1).
 */

import { ChevronRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  /** Absent on the page itself, the last crumb, and on a crumb with no page behind it. */
  to?: string;
}

interface BreadcrumbProps {
  /** Names the navigation for a screen reader, such as "Percorso". */
  label: string;
  crumbs: readonly Crumb[];
  /** The area's icon, in a disc before the first crumb. */
  icon?: LucideIcon;
}

export function Breadcrumb({ label, crumbs, icon: Icon }: BreadcrumbProps) {
  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-tight">
      {Icon !== undefined && (
        <span
          aria-hidden
          className="grid size-control-xs shrink-0 place-items-center rounded-control bg-accent-soft text-accent ring-1 ring-accent-line ring-inset max-sm:hidden"
        >
          <Icon className="size-icon" />
        </span>
      )}
      <ol className="flex min-w-0 flex-wrap items-center gap-hair text-body text-muted">
        {crumbs.map((crumb, index) => (
          <li key={crumb.to ?? crumb.label} className="flex min-w-0 items-center gap-hair">
            {index > 0 && <ChevronRight aria-hidden className="size-icon shrink-0" />}
            {index === crumbs.length - 1 ? (
              <span aria-current="page" className="truncate font-semibold text-ink">
                {crumb.label}
              </span>
            ) : crumb.to === undefined ? (
              <span className="truncate">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.to}
                className="rounded-chip hover:text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
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
