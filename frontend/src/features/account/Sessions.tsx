/**
 * The devices signed in to the account (ASVS 7.5.2): one row per session
 * still alive, the most recently used first, naming its browser and system
 * (device.ts), its address and when it was last used, the one this page
 * runs in marked and never ended here, since signing out ends it.
 *
 * Ending one, or every other, asks for the password again (PasswordDialog.tsx).
 * A session already gone when the request arrives, ended from another
 * device or expired, is the outcome asked for: the list is read again and
 * the toast says it is done, as deleting a conversation already deleted does.
 */

import { LogOut, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type AccountSession, endSessions } from "@/api/account";
import { ApiError } from "@/api/http";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Section } from "@/features/staff/page";
import { deviceName } from "./device";
import { PasswordDialog } from "./PasswordDialog";

/** The `session` that ends every one but the caller's (apps/accounts/self_views.py). */
const OTHERS = "others";

interface SessionsProps {
  sessions: AccountSession[];
  /** Reads the list again. */
  onChanged: () => Promise<unknown>;
}

export function Sessions({ sessions, onChanged }: SessionsProps) {
  const { t, i18n } = useTranslation();
  const [ending, setEnding] = useState<AccountSession | typeof OTHERS | null>(null);
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const named = (session: AccountSession) =>
    deviceName(session.user_agent) || t("account.sessions.unknown");
  const others = sessions.filter((session) => !session.current);

  const end = async (password: string) => {
    if (ending === null) return;
    const target = ending === OTHERS ? OTHERS : ending.id;
    try {
      await endSessions(password, target);
    } catch (error) {
      const gone = error instanceof ApiError && error.code === "NOT_FOUND";
      if (!gone) throw error;
    }
    await onChanged();
    toast.success(
      t(ending === OTHERS ? "account.sessions.endedOthers" : "account.sessions.ended"),
      ending === OTHERS ? undefined : { description: named(ending) },
    );
  };

  return (
    <Section
      heading={t("account.sessions.title")}
      count={sessions.length}
      right={
        others.length > 0 && (
          <Button variant="outline" onClick={() => setEnding(OTHERS)}>
            <LogOut aria-hidden className="size-icon" />
            {t("account.sessions.endOthers")}
          </Button>
        )
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("account.sessions.device")}</TableHead>
            <TableHead>{t("account.sessions.address")}</TableHead>
            <TableHead>{t("account.sessions.lastActivity")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("account.sessions.end")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell>
                <span className="flex flex-wrap items-center gap-tight">
                  <span className="font-medium">{named(session)}</span>
                  {session.current && <Badge>{t("account.sessions.current")}</Badge>}
                </span>
              </TableCell>
              <TableCell label={t("account.sessions.address")} className="font-mono">
                {session.ip ?? <span className="text-muted">—</span>}
              </TableCell>
              <TableCell
                label={t("account.sessions.lastActivity")}
                className="whitespace-nowrap tabular-nums"
              >
                {session.last_activity === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  when.format(new Date(session.last_activity))
                )}
              </TableCell>
              <TableCell className="text-right">
                {!session.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t("account.sessions.end")} · ${named(session)}`}
                    onClick={() => setEnding(session)}
                  >
                    {t("account.sessions.end")}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PasswordDialog
        open={ending !== null}
        heading={t(ending === OTHERS ? "account.sessions.endOthers" : "account.sessions.endOne")}
        description={ending === null || ending === OTHERS ? undefined : named(ending)}
        icon={ending === OTHERS ? LogOut : MonitorSmartphone}
        confirmLabel={t("account.sessions.end")}
        onConfirm={end}
        onClose={() => setEnding(null)}
      />
    </Section>
  );
}
