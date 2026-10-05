/**
 * The staff of one scope — an edition's teachers, a programme's secretariat —
 * and, for a caller who may, adding and removing them.
 *
 * One component for both, as Open edX Studio has one course team page (outside
 * the repository: Open edX source). A member is added by their exact username,
 * with no search: a search would let a caller list accounts, and the server
 * offers none. A refusal of the field shows under it; a removal is confirmed,
 * naming who and where, and afterwards focus moves to the username field, since
 * the row that opened the dialog is gone (outside the repository: WAI-ARIA APG,
 * "Dialog (Modal) Pattern"). Every change reads the list again.
 */

import { type FormEvent, useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  addMember,
  listMembers,
  type MemberScope,
  removeMember,
  type StaffMember,
} from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableRow } from "@/components/ui/table";
import { useFailure, useLoad, useStaff } from "./context";
import { fieldErrorKey, isNotFound } from "./errors";

interface MembersPanelProps {
  /** Stable across renders: the list is read again whenever it changes. */
  scope: MemberScope;
  /** The table's caption, such as "Docenti". */
  title: string;
  /** The scope as a reader names it, for the removal's question. */
  scopeName: string;
  canManage: boolean;
}

export function MembersPanel({ scope, title, scopeName, canManage }: MembersPanelProps) {
  const { t } = useTranslation();
  const { announce } = useStaff();
  const fail = useFailure();
  const load = useCallback(() => listMembers(scope), [scope]);
  const members = useLoad(load);
  const [username, setUsername] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const removed = useRef(false);
  const errorId = useId();

  const add = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const member = await addMember(scope, username.trim());
      setUsername("");
      setFieldError(null);
      announce(t("staff.members.added", { username: member.username }));
      members.reload();
    } catch (error) {
      const key = fieldErrorKey(error, "username");
      setFieldError(key === null ? fail(error) : t(key));
    }
  };

  const remove = async () => {
    if (removing === null) return false;
    const name = removing.username;
    try {
      await removeMember(scope, name);
      announce(t("staff.members.removed", { username: name }));
    } catch (error) {
      if (!isNotFound(error)) {
        setRefusal(fail(error));
        return false;
      }
      announce(t("staff.members.gone", { username: name }));
    }
    removed.current = true;
    members.reload();
    return true;
  };

  if (members.error !== null)
    return <p className="text-body text-warn-ink">{t("staff.loadFailed")}</p>;

  return (
    <section className="flex flex-col gap-snug">
      {members.data !== null && members.data.length === 0 && (
        <p className="text-body text-muted">
          {title}: {t("staff.members.empty")}
        </p>
      )}
      {members.data !== null && members.data.length > 0 && (
        <Table>
          <TableCaption>{title}</TableCaption>
          <TableBody>
            {members.data.map((member) => (
              <TableRow key={member.id}>
                <TableCell>{member.username}</TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRefusal(null);
                        setRemoving(member);
                      }}
                    >
                      {t("staff.members.remove", { username: member.username })}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canManage && (
        <form onSubmit={(event) => void add(event)} className="flex max-w-md flex-col gap-hair">
          <label htmlFor={`${errorId}-username`} className="font-medium text-caption text-ink">
            {t("staff.members.username")}
          </label>
          <div className="flex gap-tight">
            <Input
              ref={input}
              id={`${errorId}-username`}
              value={username}
              autoComplete="off"
              aria-invalid={fieldError !== null}
              aria-describedby={fieldError === null ? undefined : errorId}
              className={fieldError === null ? undefined : "border-warn-line"}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Button type="submit">{t("staff.members.add")}</Button>
          </div>
          {fieldError !== null && (
            <p id={errorId} className="text-caption text-warn-ink">
              {fieldError}
            </p>
          )}
        </form>
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("staff.members.removeTitle", { username: removing?.username ?? "" })}
        description={t("staff.members.removeBody", {
          username: removing?.username ?? "",
          group: title,
          scope: scopeName,
        })}
        cancelLabel={t("staff.cancel")}
        confirmLabel={t("staff.members.removeConfirm")}
        onConfirm={remove}
        destructive
        onCloseAutoFocus={(event) => {
          if (!removed.current) return;
          removed.current = false;
          event.preventDefault();
          input.current?.focus();
        }}
      >
        {refusal !== null && <p className="text-body text-warn-ink">{refusal}</p>}
      </AlertDialog>
    </section>
  );
}
