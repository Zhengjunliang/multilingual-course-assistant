/**
 * Invitations not accepted yet, as a table; what is done with them is
 * Invitations.tsx's.
 *
 * As GitHub lists a repository's pending invitations (outside the
 * repository): who made each over when (DESIGN.md, rule 1), when it stops
 * working, or a chip saying it has, and the button that revokes it, named
 * for a screen reader by who made it and when, since every row's says the
 * same word. A list of every scope's also names each one's role and scope,
 * the scope's name leading to its page.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Invitation } from "@/api/catalog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface InvitationTableProps {
  invitations: readonly Invitation[];
  /** Whether the rows are of every scope, each then naming its role and scope. */
  every: boolean;
  /** The revoke button of the row at `index` was pressed. */
  onRevoke: (invitation: Invitation, from: HTMLElement, index: number) => void;
}

export function InvitationTable({ invitations, every, onRevoke }: InvitationTableProps) {
  const { t, i18n } = useTranslation();
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {every && <TableHead>{t("staff.invitations.for")}</TableHead>}
          <TableHead>{t("staff.invitations.by")}</TableHead>
          <TableHead>{t("staff.invitations.expires")}</TableHead>
          <TableHead>
            <span className="sr-only">{t("staff.invitations.revoke.action")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((invitation, index) => {
          const made = when.format(new Date(invitation.created_at));
          const expired = new Date(invitation.expires_at).getTime() <= Date.now();
          return (
            <TableRow key={invitation.id}>
              {every && (
                <TableCell>
                  <Granted invitation={invitation} />
                </TableCell>
              )}
              <TableCell label={every ? t("staff.invitations.by") : undefined}>
                <span className="block font-mono font-semibold">{invitation.created_by}</span>
                <span className="block text-caption text-muted tabular-nums">{made}</span>
              </TableCell>
              <TableCell
                label={t("staff.invitations.expires")}
                className="whitespace-nowrap tabular-nums"
              >
                {expired ? (
                  <Chip>{t("staff.invitations.expired")}</Chip>
                ) : (
                  when.format(new Date(invitation.expires_at))
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-revoke-invitation
                  aria-label={t("staff.invitations.revoke.label", {
                    username: invitation.created_by,
                    date: made,
                  })}
                  onClick={(event) => onRevoke(invitation, event.currentTarget, index)}
                >
                  {t("staff.invitations.revoke.action")}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The role an invitation grants and where, leading to the scope's page. */
function Granted({ invitation }: { invitation: Invitation }) {
  const { t } = useTranslation();
  const { edition, programme } = invitation;
  const [to, name] =
    edition !== null
      ? [`/staff/editions/${edition.id}`, `${edition.course.name} · ${edition.academic_year}`]
      : [`/staff/programmes/${encodeURIComponent(programme?.code ?? "")}`, programme?.name ?? ""];
  return (
    <span className="flex flex-wrap items-center gap-tight">
      <Chip tone="accent">{t(`account.role.${invitation.role}`)}</Chip>
      <Link to={to} className="font-medium text-ink uppercase underline">
        {name}
      </Link>
    </span>
  );
}
