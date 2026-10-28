"""Deactivating, reactivating and deleting an account: the rules, the writes, the lines logged.

Every door that changes an account's access comes through here, `/admin/`
(apps/accounts/admin.py) as much as the SPA's, so a rule holds whichever one
is used. A broken rule is an `AccountRuleError` naming it, and each door turns
it into a refusal of its own, the API's through `refuse`; `refusal` lets a
door ask first, and not offer what would be refused.

An inactive account's session reads as nobody's, but would read as the
account's again the day it is reactivated: deactivating ends every session of
the account (apps/accounts/sessions.py), and reactivating ends them as well,
for a deactivation that did not come through here (a shell, a bulk
`.update()`). Deleting needs neither: the sessions, the conversations and the
roles go with the account (`CASCADE`).

A superuser's door cannot take the last active superuser away, without a rule
of its own: the caller, an active superuser, is not the account it changes.
An account deleting itself can be the last one, and `delete_own_account`
holds the rule there.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, NoReturn

from django.contrib.auth import logout
from django.db import transaction

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.models import User
from apps.accounts.sessions import end_sessions
from apps.roles.models import RoleAssignment
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from django.http import HttpRequest
    from rest_framework.request import Request


class AccountRule(StrEnum):
    """Every rule a change to an account's access can break, each the API's code for it."""

    # Nobody takes their own access away: another superuser does, so no
    # account locks the last door back in from inside.
    SELF_NOT_ALLOWED = ErrorCode.SELF_NOT_ALLOWED
    # Deactivating is the step that can be undone; deleting takes the
    # account's conversations with it, so it comes second.
    ACCOUNT_STILL_ACTIVE = ErrorCode.ACCOUNT_STILL_ACTIVE
    # Staff leave by having their roles revoked, by whoever granted them, and
    # not by deleting the account under them: a scope would lose its staff
    # without anyone who manages it knowing.
    ROLES_HELD = ErrorCode.ROLES_HELD
    # The site needs one active superuser to manage its accounts; Onyx and
    # RAGFlow keep the last admin the same way (outside the repository).
    LAST_SUPERUSER = ErrorCode.LAST_SUPERUSER


class AccountRuleError(Exception):
    """`rule` forbids the change asked for."""

    def __init__(self, rule: AccountRule) -> None:
        super().__init__(rule)
        self.rule = rule


def refuse(rule: AccountRule) -> NoReturn:
    """Refuses an API request with `rule`'s code (config/errors.py)."""
    fail(ErrorCode(rule))


def refusal(actor: User, user: User, *, delete: bool = False) -> AccountRule | None:
    """The rule `actor` breaks by taking `user`'s access away, None when none.

    Taking it away is deactivating the account or demoting it from
    superuser, and with `delete`, deleting it.
    """
    if user.pk == actor.pk:
        return AccountRule.SELF_NOT_ALLOWED
    if delete and user.is_active:
        return AccountRule.ACCOUNT_STILL_ACTIVE
    return None


def deactivate(actor: User, user: User, request: HttpRequest | None) -> None:
    """Deactivates `user` and ends its sessions; `AccountRuleError` when a rule forbids it."""
    if rule := refusal(actor, user):
        raise AccountRuleError(rule)
    user.is_active = False
    user.save(update_fields=["is_active"])
    ended = end_sessions(user)
    auth_event(AuthEvent.DEACTIVATE, request, user, by=actor.get_username(), sessions=ended)


def activate(actor: User, user: User, request: HttpRequest | None) -> None:
    """Reactivates `user`, which signs in afresh: no session from before survives."""
    user.is_active = True
    user.save(update_fields=["is_active"])
    end_sessions(user)
    auth_event(AuthEvent.ACTIVATE, request, user, by=actor.get_username())


def delete_account(actor: User, user: User, request: HttpRequest | None) -> None:
    """Deletes `user` and all it owns; `AccountRuleError` when a rule forbids it."""
    if rule := refusal(actor, user, delete=True):
        raise AccountRuleError(rule)
    # Logged first: once deleted, the account has no key to name.
    auth_event(AuthEvent.DELETE, request, user, by=actor.get_username())
    user.delete()


def delete_own_account(user: User, request: Request) -> None:
    """The caller deletes their own account, signed out first; `AccountRuleError` when forbidden.

    No deactivation first: the owner, who confirmed with their password, is
    the one the step would protect. The active superusers are locked while
    they are counted, so two of them deleting themselves at once leave one.
    """
    with transaction.atomic():
        if RoleAssignment.objects.filter(user=user).exists():
            raise AccountRuleError(AccountRule.ROLES_HELD)
        if user.is_superuser:
            active = User.objects.filter(is_superuser=True, is_active=True)
            if list(active.select_for_update().values_list("pk", flat=True)) == [user.pk]:
                raise AccountRuleError(AccountRule.LAST_SUPERUSER)
        auth_event(AuthEvent.DELETE, request, user, by=user.get_username())
        # Signed out before the row goes: the session would otherwise be
        # saved at the end of the request, over a row its account took with
        # it, and the request would fail.
        logout(request)
        user.delete()
