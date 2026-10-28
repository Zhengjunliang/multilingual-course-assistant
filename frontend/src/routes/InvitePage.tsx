import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { acceptInvitation, lookUpInvitation } from "@/api/account";
import type { InvitationGrant } from "@/api/catalog";
import { isSessionLost } from "@/api/http";
import { useSession } from "@/auth/useSession";
import { useFormRefusal } from "@/components/FormRefusal";
import { Chip } from "@/components/ui/chip";
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@/i18n";
import { describeError, type ErrorText } from "@/lib/errorText";
import { AuthButton, AuthLayout, NewAccountFields } from "./AuthLayout";
import { useLanding } from "./landing";
import { isDeadLink, LinkFailure, useLink } from "./link";

const FIELDS = ["username", "password"];

/** The page of what an invitation makes its holder staff of. */
function pageOf(grant: InvitationGrant): string {
  return grant.edition !== null
    ? `/staff/editions/${grant.edition.id}`
    : `/staff/programmes/${grant.programme?.code ?? ""}`;
}

function scopeName(grant: InvitationGrant): string {
  return grant.edition !== null
    ? `${grant.edition.course.name} · ${grant.edition.academic_year}`
    : (grant.programme?.name ?? "");
}

/**
 * `/invite#<token>`: an invitation to a staff role on one scope, a teacher
 * of an edition or the secretariat of a programme (routes/link.tsx). The
 * card names the role and the scope; a reader with no account makes one
 * here, with a username and a password of their own held to the
 * registration's rules, and one signed in accepts as themselves, or signs
 * out to make another. Either way the page then reads the session again,
 * which now holds the role, and goes to the scope's page. A session signed
 * in longer ago than a staff session may last ends at that reading
 * (apps/accounts/middleware.py), and the scope's page then sends its reader
 * through the login, the role already theirs.
 *
 * The account shown is the one the reader sent as: while the page answers a
 * send, an account signed in by it does not turn the form into the other.
 */
export default function InvitePage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { account, logOut, forget, recheck } = useSession();
  const link = useLink(lookUpInvitation);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const landing = useLanding(link.target === null ? "/" : pageOf(link.target));
  const refusal = useFormRefusal(failure, FIELDS);
  const [who, setWho] = useState(account);
  useEffect(() => {
    if (landing.phase === "idle") setWho(account);
  }, [account, landing.phase]);

  // The language the page is read in becomes a new account's, as registering makes it.
  const locale: UiLocale = isUiLocale(i18n.language) ? i18n.language : DEFAULT_UI_LOCALE;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    await landing.send(
      async () => {
        await acceptInvitation(
          link.token,
          who === null ? { username, password, locale } : undefined,
        );
        await recheck();
      },
      (error) => {
        if (isDeadLink(error)) {
          link.died();
          return;
        }
        if (isSessionLost(error)) forget();
        setFailure(describeError(error, { shownFields: FIELDS }));
      },
    );
  };

  const grant = link.target;
  return (
    <AuthLayout
      heading={t("auth.inviteTitle")}
      refusals={landing.refusals}
      phase={landing.phase}
      footer={
        who === null ? (
          <>
            {t("auth.haveAccount")}{" "}
            <Link
              to="/login"
              state={{ from: location.pathname + location.hash }}
              className="font-medium text-ink underline"
            >
              {t("auth.logIn")}
            </Link>
          </>
        ) : (
          <>
            {t("auth.notYou", { username: who.username })}{" "}
            <button
              type="button"
              className="font-medium text-ink underline"
              onClick={() =>
                void logOut().catch((error: unknown) => setFailure(describeError(error)))
              }
            >
              {t("account.logOut")}
            </button>
          </>
        )
      }
    >
      {link.failure !== null && <LinkFailure failure={link.failure} onRetry={link.retry} />}
      {grant !== null && (
        <form className="flex flex-col gap-room" onSubmit={(event) => void onSubmit(event)}>
          <div className="flex flex-col items-center gap-tight text-center">
            <Chip tone="accent">{t(`account.role.${grant.role}`)}</Chip>
            <p className="font-semibold text-body text-ink uppercase">{scopeName(grant)}</p>
          </div>
          {who === null ? (
            <NewAccountFields
              username={username}
              password={password}
              onUsername={setUsername}
              onPassword={setPassword}
              refusal={refusal}
            />
          ) : (
            <p className="text-center text-body text-muted">
              {t("auth.acceptAs", { username: who.username })}
            </p>
          )}
          {refusal.alert}
          <AuthButton phase={landing.phase}>
            {t(who === null ? "auth.acceptAndRegister" : "auth.accept")}
          </AuthButton>
        </form>
      )}
    </AuthLayout>
  );
}
