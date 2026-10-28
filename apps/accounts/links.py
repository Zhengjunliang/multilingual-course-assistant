"""Links one person hands another, each good for one use: a password reset, and an invitation.

A superuser makes a reset link for an account whose owner lost the password,
and hands it over in person; the site sends no mail. An invitation
(apps/roles/invitations.py) is handed over the same way, and its token made
and opened by the same two functions below, `new_token` and `live`. The
token is the only credential the holder has, so it travels in a request's
body and never in a URL a log would keep. It is 256 random bits, stored as
its SHA-256 alone, so a copy of the table opens no link; a fast digest is
enough for a secret nobody chose, which no guessing reaches. Not Django's
`PasswordResetTokenGenerator`, which stores nothing: its links stay valid
until the password changes, so a newer link could not void the one before.

A link that does not work, its token unknown, used, replaced by a newer link,
voided by a password change or past its time, is one 404 `LINK_EXPIRED`
whichever: the holder does the same thing for each, asks for a new one, and a
caller trying tokens learns nothing from the answer.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import TYPE_CHECKING

from django.contrib.auth import logout
from django.db import transaction
from django.utils import timezone

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.models import ResetLink
from apps.accounts.passwords import set_password_checked
from apps.accounts.services import AccountRule, AccountRuleError
from apps.accounts.sessions import end_sessions
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from datetime import datetime

    from django.db.models import QuerySet
    from rest_framework.request import Request

    from apps.accounts.models import User
    from apps.accounts.services import Caller
    from apps.roles.models import Invitation

# The longest NIST SP 800-63B-4 lets a recovery code sent by email live
# (section 4.2.1.2, outside the repository): a link handed over in person
# travels by mail or chat as often as not.
RESET_LINK_LIFETIME = timedelta(hours=24)


def digest(token: str) -> str:
    """What the table stores in a token's place."""
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    """A token, and its digest."""
    token = secrets.token_urlsafe(32)
    return token, digest(token)


def make_reset_link(actor: User, user: User, request: Caller) -> tuple[str, datetime]:
    """A new reset link for `user`, which voids any before it: its token and when it expires.

    The token is returned this once and never stored. A deactivated account
    gets one too, so whoever comes back sets a password before being let in
    again. `AccountRuleError` for the caller's own account, whose password
    its owner changes themselves, confirming the one they have.
    """
    if user.pk == actor.pk:
        raise AccountRuleError(AccountRule.SELF_NOT_ALLOWED)
    token, token_hash = new_token()
    expires_at = timezone.now() + RESET_LINK_LIFETIME
    ResetLink.objects.update_or_create(
        user=user, defaults={"token_hash": token_hash, "expires_at": expires_at}
    )
    auth_event(AuthEvent.RESET_LINK_CREATED, request, user, by=actor.get_username())
    return token, expires_at


def live[L: (ResetLink, Invitation)](links: QuerySet[L], token: str) -> L:
    """The link of `links` that `token` opens; fails with `LINK_EXPIRED` when none does."""
    link = links.filter(token_hash=digest(token), expires_at__gt=timezone.now()).first()
    if link is None:
        fail(ErrorCode.LINK_EXPIRED)
    return link


def reset_link_owner(token: str) -> User:
    """The account `token` resets, for the page to name; the link stays as it is."""
    return live(ResetLink.objects.select_related("user"), token).user


def reset_password(token: str, password: str, request: Request) -> None:
    """Sets the password of the account `token` resets, ends every session of it, voids the link.

    The link is locked while it is used, so two requests holding it set one
    password: the second finds no link. A password the rules refuse raises
    Django's `ValidationError` before anything is written, and the link
    stays for the next try. Nobody is signed in: the holder signs in with the
    new password, as the OWASP Forgot Password Cheat Sheet asks (outside the
    repository).
    """
    with transaction.atomic():
        link = live(ResetLink.objects.select_for_update().select_related("user"), token)
        user = link.user
        set_password_checked(user, password)
        user.save(update_fields=["password"])
        link.delete()
        # A holder signed in as the account itself is signed out here, once
        # the password is accepted, for the reason `delete_own_account` gives
        # (apps/accounts/services.py): the request's own session is one of
        # the rows ended below.
        if request.user.pk == user.pk:
            logout(request)
        ended = end_sessions(user)
    auth_event(AuthEvent.PASSWORD_RESET, request, user, sessions=ended)
