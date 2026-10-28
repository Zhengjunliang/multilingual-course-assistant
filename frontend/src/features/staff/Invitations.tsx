/**
 * The invitations of a scope (#167): a link that makes whoever opens it a
 * teacher of the edition or secretariat staff of the programme, made and
 * revoked by whoever may grant that role there
 * (apps/catalog/invitation_views.py), and, on the superuser's page of
 * accounts, every scope's at once.
 *
 * The button that makes one sits beside the one that assigns an existing
 * account (actions.tsx), for a reader whose `permissions` hold the grant
 * alone, and the link is shown the one time it exists (OneTimeLink.tsx).
 * Under the scope's staff, the invitations not accepted yet
 * (InvitationTable.tsx), under a heading with their count; a scope with
 * none shows nothing there. Each is revoked after one question. An
 * invitation gone before its revoke arrived was accepted or revoked
 * elsewhere: the page reads again, since an accepted one is a new member of
 * its staff.
 */

import { Link2, Link2Off } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  createInvitation,
  type Invitation,
  listAllInvitations,
  listInvitations,
  type MemberScope,
  revokeInvitation,
} from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { ErrorText } from "@/lib/errorText";
import { returnFocus } from "./actions";
import { useFailure, useLoad } from "./context";
import { isNotFound } from "./errors";
import { InvitationTable } from "./InvitationTable";
import { OneTimeLink, type Shown } from "./OneTimeLink";
import { Section } from "./page";
import { PartFailure, WriteFailure } from "./Refusal";

interface InvitationsOptions {
  /** Where the invitations are, or null for every scope's, which only the superuser reads; stable. */
  scope: MemberScope | null;
  /** Whether the reader may invite here, which the scope's `permissions` say. */
  canInvite: boolean;
  /** What an invitation is to, under the link's heading. */
  object: string;
  /** Reads the page again: a scope gone, or an invitation accepted, changes it. */
  reloadPage: () => Promise<unknown>;
}

interface Invitations {
  /** The button that makes one, or null for a reader who may not. */
  invite: ReactNode;
  /** How many are listed, once read. */
  count: number | undefined;
  /** The list, or null where there is none to show. */
  list: ReactNode;
  dialogs: ReactNode;
}

export function useInvitations({
  scope,
  canInvite,
  object,
  reloadPage,
}: InvitationsOptions): Invitations {
  const { t, i18n } = useTranslation();
  const fail = useFailure();
  const load = useCallback((): Promise<Invitation[]> => {
    if (scope === null) return listAllInvitations();
    // Only a reader who may grant the role may read who was invited to it.
    return canInvite ? listInvitations(scope) : Promise.resolve([]);
  }, [scope, canInvite]);
  const invitations = useLoad(load);
  const [running, setRunning] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [refusal, setRefusal] = useState<ErrorText | null>(null);
  const madeFrom = useRef<HTMLElement>(undefined);
  // The button was off while the request ran, which drops its focus.
  const refocus = useRef(false);
  const last = useRef<{ trigger?: HTMLElement; index: number }>({ index: 0 });
  const rows = invitations.data ?? [];
  const every = scope === null;
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    if (running || !refocus.current) return;
    refocus.current = false;
    madeFrom.current?.focus();
  }, [running]);

  const create = async (from: HTMLElement) => {
    if (scope === null || running) return;
    madeFrom.current = from;
    setRunning(true);
    try {
      const made = await createInvitation(scope);
      await invitations.reload();
      setShown({ path: "/invite", token: made.token, expires_at: made.expires_at });
    } catch (error) {
      if (isNotFound(error)) await reloadPage();
      else {
        const { sentence } = fail(error);
        toast.error(t("staff.invitations.failed"), {
          description: t(sentence.key, sentence.values),
        });
        refocus.current = true;
      }
    } finally {
      setRunning(false);
    }
  };

  const confirm = async () => {
    if (revoking === null) return false;
    setRefusal(null);
    try {
      await revokeInvitation(revoking);
    } catch (error) {
      if (!isNotFound(error)) {
        setRefusal(fail(error));
        return false;
      }
      await Promise.all([reloadPage(), invitations.reload()]);
      toast(t("staff.invitations.gone"));
      return true;
    }
    await invitations.reload();
    toast.success(t("staff.invitations.revoke.done"));
    return true;
  };

  const invite =
    scope !== null && canInvite ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-invite
        pending={running}
        onClick={(event) => void create(event.currentTarget)}
      >
        <Link2 aria-hidden className="size-icon" />
        {t(
          scope.kind === "edition" ? "staff.invitations.teacher" : "staff.invitations.secretariat",
        )}
      </Button>
    ) : null;

  const table = (
    <InvitationTable
      invitations={rows}
      every={every}
      onRevoke={(invitation, trigger, index) => {
        last.current = { trigger, index };
        setRevoking(invitation);
      }}
    />
  );

  let list: ReactNode = null;
  if (invitations.error !== null) list = <PartFailure onRetry={() => void invitations.reload()} />;
  else if (rows.length > 0)
    list = every ? (
      table
    ) : (
      <Section heading={t("staff.invitations.title")} count={rows.length}>
        {table}
      </Section>
    );
  else if (every && invitations.data !== null)
    list = (
      <p className="rounded-card border border-line bg-surface px-snug py-room text-center text-body text-muted">
        {t("staff.invitations.none")}
      </p>
    );

  const dialogs = (
    <>
      <OneTimeLink
        shown={shown}
        heading={t("staff.invitations.link")}
        description={object}
        onClose={() => setShown(null)}
        onCloseAutoFocus={returnFocus(
          () => madeFrom.current,
          () => [document.querySelector("main [data-invite]")],
        )}
      />
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRefusal(null);
          setRevoking(null);
        }}
        heading={t("staff.invitations.revoke.title")}
        icon={Link2Off}
        description={
          revoking === null ? (
            ""
          ) : (
            <Trans
              i18nKey="staff.invitations.revoke.body"
              values={{
                username: revoking.created_by,
                date: when.format(new Date(revoking.created_at)),
              }}
              components={{ person: <Chip className="font-mono" /> }}
            />
          )
        }
        cancelLabel={t("staff.cancel")}
        confirmLabel={t("staff.invitations.revoke.action")}
        onConfirm={confirm}
        onCloseAutoFocus={returnFocus(
          () => last.current.trigger,
          () => {
            const left = document.querySelectorAll("main [data-revoke-invitation]");
            const { index } = last.current;
            return [left[index], left[index - 1], document.querySelector("main [data-invite]")];
          },
        )}
      >
        {refusal !== null && <WriteFailure text={refusal} />}
      </AlertDialog>
    </>
  );
  return { invite, count: invitations.data?.length, list, dialogs };
}
