/**
 * `/account`: what belongs to the signed-in account rather than to a
 * conversation or a scope (#167), reached from the account menu: the roles
 * it holds, its password, the devices signed in to it, and deleting it. The
 * language is not repeated here: the account menu that leads here sets it,
 * one level up. One page of sections, the way GitHub's
 * and Google's account pages stack theirs, deleting last in the warning's
 * tint (outside the repository).
 *
 * The page's head is the account itself, its avatar, its name and its widest
 * role, as the menu's head shows it. The roles section lists what the account
 * holds on a scope, so a student's page and a superuser's that holds nothing
 * else have none: the head's word says it all. A role names its scope by the
 * scope's own name, read from what the shell holds (the programmes) and from
 * the edition list (the editions), and leads to its page. Each section is its
 * heading and its controls (DESIGN.md, Do's and Don'ts); the only captions
 * are the password's rules and what deleting takes with it.
 *
 * Deleting asks for the password; the server refuses staff still holding a
 * role and the last active superuser, and the dialog says which. Once it is
 * done the account is signed out, and the page leaves for the front page as
 * a visitor, the question being typed forgotten with it (features/chat/draft.ts).
 */

import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { type Account, deleteOwnAccount, listSessions } from "@/api/account";
import { listEditions } from "@/api/catalog";
import { roleOf } from "@/auth/staff";
import { useSession } from "@/auth/useSession";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PasswordChange } from "@/features/account/PasswordChange";
import { PasswordDialog } from "@/features/account/PasswordDialog";
import { Sessions } from "@/features/account/Sessions";
import { clearDraft } from "@/features/chat/draft";
import { useLoad } from "@/features/staff/context";
import { Section } from "@/features/staff/page";
import { LoadFailure } from "@/features/staff/Refusal";
import { useShell } from "./shell";

export default function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { account, forget } = useSession();
  const { back } = useShell();
  const sessions = useLoad(listSessions);
  const [deleting, setDeleting] = useState(false);

  if (account === null) return null;
  const role = roleOf(account);

  const remove = async (password: string) => {
    await deleteOwnAccount(password);
    clearDraft();
    void navigate("/", { replace: true });
    forget();
  };

  return (
    <>
      <header className="flex items-center gap-snug">
        <Avatar name={account.username} />
        <div className="flex min-w-0 flex-col items-start gap-hair">
          <h1 tabIndex={-1} className="truncate font-semibold text-display text-ink outline-none">
            {account.username}
          </h1>
          <Chip tone={role === "student" ? "neutral" : "accent"}>{t(`account.role.${role}`)}</Chip>
        </div>
      </header>

      {account.roles.length > 0 && (
        <Section heading={t("account.roles")}>
          <Roles account={account} />
        </Section>
      )}

      <Section heading={t("account.password.title")}>
        <PasswordChange username={account.username} onChanged={() => void sessions.reload()} />
      </Section>

      {sessions.error !== null ? (
        <LoadFailure error={sessions.error} back={back} onRetry={() => void sessions.reload()} />
      ) : (
        sessions.data !== null && <Sessions sessions={sessions.data} onChanged={sessions.reload} />
      )}

      <Section heading={t("account.delete.title")}>
        <p className="text-body text-muted">{t("account.delete.consequence")}</p>
        <Button variant="warn" className="self-start" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden className="size-icon" />
          {t("account.delete.confirm")}
        </Button>
      </Section>
      <PasswordDialog
        open={deleting}
        heading={t("account.delete.title")}
        description={account.username}
        icon={Trash2}
        warn
        confirmLabel={t("account.delete.confirm")}
        onConfirm={remove}
        onClose={() => setDeleting(false)}
      >
        <p className="text-body text-ink">{t("account.delete.consequence")}</p>
      </PasswordDialog>
    </>
  );
}

/**
 * The roles the account holds on a scope, each naming it and leading to its
 * page, after the superuser's.
 */
function Roles({ account }: { account: Account }) {
  const { t } = useTranslation();
  const { programmes } = useShell();
  const teaches = account.roles.some((held) => held.role === "teacher");
  const load = useCallback(() => (teaches ? listEditions() : Promise.resolve([])), [teaches]);
  const editions = useLoad(load);

  const rows = account.roles.map((held) => {
    if (held.role === "secretariat") {
      const programme = programmes?.find((listed) => listed.code === held.programme);
      return {
        key: `secretariat-${held.programme}`,
        role: held.role,
        to: `/staff/programmes/${held.programme}`,
        name: programme?.name ?? held.programme,
      };
    }
    const edition = editions.data?.find((listed) => listed.id === held.edition);
    return {
      key: `teacher-${held.edition}`,
      role: held.role,
      to: `/staff/editions/${held.edition}`,
      name: edition === undefined ? null : `${edition.course.name} · ${edition.academic_year}`,
    };
  });

  return (
    <ul className="flex flex-col gap-tight">
      {account.is_superuser && (
        <li>
          <Chip tone="accent">{t("account.role.admin")}</Chip>
        </li>
      )}
      {rows.map((row) => (
        <li key={row.key} className="flex flex-wrap items-center gap-tight">
          <Chip tone="accent">{t(`account.role.${row.role}`)}</Chip>
          {row.name !== null && (
            <Link to={row.to} className="font-medium text-body text-ink uppercase underline">
              {row.name}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
