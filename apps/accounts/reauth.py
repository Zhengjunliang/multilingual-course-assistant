"""Asking the signed-in caller for their password again, before a change to their own account.

A session is not proof that its owner is at the keyboard: whoever finds a
browser left signed in has one too. Changing the password and ending another
device's session therefore ask for the password first (ASVS 6.2.3 and 7.5.2,
outside the repository). A wrong one fails as a wrong login does, with
`WRONG_CREDENTIALS`, a 400 the page does not read as a session lost, and its
line in the log. The views it guards are throttled at the login's rate,
counted per account, so it is no faster a way to guess.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from apps.accounts.events import AuthEvent, auth_event
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from rest_framework.request import Request


def require_password(request: Request, user: AbstractBaseUser, password: str) -> None:
    """Fails with `WRONG_CREDENTIALS` unless `password` is `user`'s own."""
    if not user.check_password(password):
        auth_event(AuthEvent.REAUTH_FAILED, request, user)
        fail(ErrorCode.WRONG_CREDENTIALS)
