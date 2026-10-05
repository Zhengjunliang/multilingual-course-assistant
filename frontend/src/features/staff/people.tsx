/**
 * Staff as the pages show them: by username, the one name the API gives
 * (`StaffMember`), behind the letter `Avatar` draws from it.
 *
 * Two shapes. `PeopleInline` fits a table cell: the letters overlapping, then
 * the names in one line. `StaffList` is a section's list, one person a row,
 * the reader marked "tu", and room at the end of each row for an action.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { StaffMember } from "@/api/catalog";
import { useSession } from "@/auth/useSession";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export function PeopleInline({ people }: { people: readonly StaffMember[] }) {
  return (
    <span className="flex min-w-0 items-center gap-tight">
      <span className="flex shrink-0 -space-x-hair">
        {people.map((person) => (
          <Avatar
            key={person.id}
            name={person.username}
            size="sm"
            className="ring-2 ring-surface"
          />
        ))}
      </span>
      <span className="truncate font-mono text-body text-ink">
        {people.map((person) => person.username).join(", ")}
      </span>
    </span>
  );
}

interface StaffListProps {
  people: readonly StaffMember[];
  /** What the list says when it holds nobody. */
  empty: string;
  /** Rendered at the end of a person's row, such as the button that revokes them. */
  action?: (person: StaffMember) => ReactNode;
}

export function StaffList({ people, empty, action }: StaffListProps) {
  const { t } = useTranslation();
  const { account } = useSession();

  if (people.length === 0) return <p className="px-snug py-gutter text-body text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {people.map((person) => (
        <li key={person.id} className="flex items-center gap-snug px-snug py-tight">
          <Avatar name={person.username} />
          <span className="flex min-w-0 flex-1 items-center gap-tight font-mono text-body text-ink">
            <span className="truncate">{person.username}</span>
            {person.username === account?.username && (
              <Badge className="font-sans">{t("staff.you")}</Badge>
            )}
          </span>
          {action?.(person)}
        </li>
      ))}
    </ul>
  );
}
