/**
 * The staff pages' writes, wired once for every page that offers them:
 * assigning and revoking a scope's members, and making an edition current.
 * Each hook holds its dialog's state and returns the buttons that open it and
 * the dialog itself, for the page to place where the prototype puts them;
 * after a write the page reads again, since every row's flags may change.
 * A button is offered only where the row's `permissions` hold its permission.
 *
 * Focus goes back to the button that opened the dialog, as Radix does. When
 * that button is gone — its row revoked, its edition made current — it goes,
 * in the prototype's order, to the "Revoca" that took the row's place, then
 * the one before it, then the "Assegna…" button, else the page's heading.
 */

import { UserPlus } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Edition, MemberScope, StaffMember } from "@/api/catalog";
import { Button } from "@/components/ui/button";
import { AssignDialog } from "./AssignDialog";
import { RevokeDialog, type Revoking } from "./RevokeDialog";
import { SetCurrentDialog } from "./SetCurrentDialog";

/** The handler that puts focus somewhere real when the dialog that held it closes. */
function returnFocus(
  trigger: () => HTMLElement | undefined,
  fallbacks: () => readonly (Element | null | undefined)[],
) {
  return (event: Event) => {
    if (trigger()?.isConnected) return;
    event.preventDefault();
    const heading = document.querySelector("main h1");
    const target = [...fallbacks(), heading].find((element) => element?.isConnected);
    if (target instanceof HTMLElement) target.focus();
  };
}

interface MembersOptions {
  scope: MemberScope;
  people: readonly StaffMember[];
  /** What the role is held on, as the dialogs and toasts name it. */
  object: string;
  canManage: boolean;
  /** The revoke question's body for `username`. */
  sentence: (username: string) => string;
  reload: () => Promise<void>;
}

interface Members {
  /** The "Assegna…" button, or null for a reader who may not assign. */
  assign: ReactNode;
  /** A row's "Revoca", for `StaffList`'s `action`; undefined for a reader who may not. */
  action: ((person: StaffMember) => ReactNode) | undefined;
  dialogs: ReactNode;
}

export function useMembers({
  scope,
  people,
  object,
  canManage,
  sentence,
  reload,
}: MembersOptions): Members {
  const { t } = useTranslation();
  const [assigning, setAssigning] = useState(false);
  const [revoking, setRevoking] = useState<Revoking | null>(null);
  // Read when the dialog has closed and its state is gone.
  const last = useRef<{ trigger?: HTMLElement; index: number }>({ index: 0 });

  const assign = canManage ? (
    <Button type="button" size="sm" data-assign onClick={() => setAssigning(true)}>
      <UserPlus aria-hidden className="size-icon" />
      {t(scope.kind === "edition" ? "staff.assign.teacher" : "staff.assign.secretariat")}
    </Button>
  ) : null;

  const action = canManage
    ? (person: StaffMember) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-revoke
          aria-label={t("staff.revoke.actionLabel", { username: person.username })}
          onClick={(event) => {
            last.current = { trigger: event.currentTarget, index: people.indexOf(person) };
            setRevoking({
              scope,
              username: person.username,
              object,
              sentence: sentence(person.username),
            });
          }}
        >
          {t("staff.revoke.action")}
        </Button>
      )
    : undefined;

  const dialogs = (
    <>
      <AssignDialog
        scope={assigning ? scope : null}
        object={object}
        onClose={() => setAssigning(false)}
        onChanged={reload}
      />
      <RevokeDialog
        revoking={revoking}
        onClose={() => setRevoking(null)}
        onChanged={reload}
        onCloseAutoFocus={returnFocus(
          () => last.current.trigger,
          () => {
            const left = document.querySelectorAll("main [data-revoke]");
            const { index } = last.current;
            return [left[index], left[index - 1], document.querySelector("main [data-assign]")];
          },
        )}
      />
    </>
  );
  return { assign, action, dialogs };
}

interface SetCurrentOptions {
  /** The editions the page shows, among which the one a switch replaces is found. */
  editions: readonly Edition[];
  reload: () => Promise<void>;
}

interface SetCurrent {
  /** The edition's "Imposta come corrente", or null where the switch is not offered. */
  button: (edition: Edition) => ReactNode;
  dialog: ReactNode;
}

export function useSetCurrent({ editions, reload }: SetCurrentOptions): SetCurrent {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Edition | null>(null);
  const last = useRef<{ trigger?: HTMLElement; id?: number }>({});

  // Offered on an edition that is not current and that the switch would let
  // through, both ends included (`can_set_current`).
  const button = (edition: Edition) =>
    edition.is_current || !edition.can_set_current ? null : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        // Above the row's stretched link, so the button is what it presses.
        className="relative z-10"
        onClick={(event) => {
          last.current = { trigger: event.currentTarget, id: edition.id };
          setTarget(edition);
        }}
      >
        {t("staff.setCurrent.action")}
      </Button>
    );

  const replaced =
    target === null
      ? null
      : (editions.find(
          (edition) =>
            edition.course.code === target.course.code &&
            edition.is_current &&
            edition.id !== target.id,
        ) ?? null);

  const dialog = (
    <SetCurrentDialog
      edition={target}
      replaced={replaced}
      onClose={() => setTarget(null)}
      onChanged={reload}
      onCloseAutoFocus={returnFocus(
        () => last.current.trigger,
        () => {
          const path = `/staff/editions/${last.current.id}`;
          return [document.querySelector(`main a[href="${path}"], main a[href^="${path}?"]`)];
        },
      )}
    />
  );
  return { button, dialog };
}
