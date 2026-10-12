/**
 * Staff as the pages show them (`StaffMember`): by name over username, as
 * GitHub lists a repository's collaborators, or by username alone for an
 * account with no name, behind the letters `Avatar` draws from what is shown.
 *
 * Two shapes. `PeopleInline` fits a table cell: the letters overlapping, then
 * the names in one line. `StaffList` is a section's list, a panel with one
 * person a row (DESIGN.md, rules 1, 2 and 4): the avatar in the tone of the
 * role the list is of, the accent for teachers and the neutral for the
 * secretariat, the name over the username, the role on a chip, the reader
 * marked "tu", and room at the end of each row for an action.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { StaffMember } from "@/api/catalog";
import { useSession } from "@/auth/useSession";
import { Avatar } from "@/components/ui/avatar";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";

/** What a person is called on the page: their name, or their username when they have none. */
export function shownName(person: StaffMember): string {
  return person.name === "" ? person.username : person.name;
}

export function PeopleInline({ people }: { people: readonly StaffMember[] }) {
  return (
    <span className="flex min-w-0 items-center gap-tight">
      <AvatarStack names={people.map(shownName)} max={people.length} />
      <span className="truncate text-body text-ink">{people.map(shownName).join(", ")}</span>
    </span>
  );
}

interface StaffListProps {
  people: readonly StaffMember[];
  /** The role every person of the list holds here. */
  staffRole: "teacher" | "secretariat";
  /** What the list says when it holds nobody. */
  empty: string;
  /** Rendered at the end of a person's row, such as the button that revokes them. */
  action?: (person: StaffMember) => ReactNode;
}

export function StaffList({ people, staffRole, empty, action }: StaffListProps) {
  const { t } = useTranslation();
  const { account } = useSession();

  if (people.length === 0) {
    return (
      <p className="rounded-card border border-line bg-surface px-snug py-gutter text-body text-muted">
        {empty}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-card border border-line bg-surface">
      {people.map((person) => (
        <li key={person.id} className="flex min-h-table-row items-center gap-snug px-snug py-tight">
          <Avatar name={shownName(person)} tone={staffRole === "teacher" ? "accent" : "neutral"} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-tight">
              <span
                className={
                  person.name === ""
                    ? "truncate font-mono font-semibold text-body text-ink"
                    : "truncate font-semibold text-body text-ink"
                }
              >
                {shownName(person)}
              </span>
              {person.username === account?.username && <Badge>{t("staff.you")}</Badge>}
            </span>
            {person.name !== "" && (
              <span className="truncate font-mono text-caption text-muted">{person.username}</span>
            )}
          </span>
          <Chip tone={staffRole === "teacher" ? "accent" : "neutral"}>
            {t(`account.role.${staffRole}`)}
          </Chip>
          {action?.(person)}
        </li>
      ))}
    </ul>
  );
}
