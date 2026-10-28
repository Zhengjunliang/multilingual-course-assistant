"""Deactivating, reactivating and deleting an account: the rules, the writes, the lines logged.

Every door that changes an account's access comes through here, `/admin/`
(apps/accounts/admin.py) as much as the SPA's, so a rule holds whichever one
is used. A broken rule is an `AccountRuleError` naming it, and each door turns
it into a refusal of its own; `refusal` lets a door ask first, and not offer
what would be refused.

An inactive account's session reads as nobody's, but would read as the
account's again the day it is reactivated: deactivating ends every session of
the account (apps/accounts/sessions.py), and reactivating ends them as well,
for a deactivation that did not come through here (a shell, a bulk
`.update()`). Deleting needs neither: the sessions, the conversations and the
roles go with the account (`CASCADE`).

The last active superuser cannot be deactivated, demoted or deleted here
either, without a rule of its own: every door here is a superuser's, and the
caller, an active superuser, is not the account it changes.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.sessions import end_sessions

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.accounts.models import User


class AccountRule(StrEnum):
    """Every rule a change to an account's access can break."""

    # Nobody takes their own access away: another superuser does, so no
    # account locks the last door back in from inside.
    SELF_NOT_ALLOWED = "SELF_NOT_ALLOWED"
    # Deactivating is the step that can be undone; deleting takes the
    # account's conversations with it, so it comes second.
    ACCOUNT_STILL_ACTIVE = "ACCOUNT_STILL_ACTIVE"


class AccountRuleError(Exception):
    """`rule` forbids the change asked for."""

    def __init__(self, rule: AccountRule) -> None:
        super().__init__(rule)
        self.rule = rule


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
