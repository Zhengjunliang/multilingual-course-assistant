"""Authentication events (#13): one line each, under one logger, from one function.

What the log has to answer after an incident is who got in, who tried and
failed, and from where. Signing in, signing out and a failed attempt are read
off Django's own signals (apps/accounts/apps.py), not off this app's views:
`/admin/login/` passes through no view here, and neither will the logout of a
session that ran out. Registering has no signal, so `RegisterView` calls
`auth_event` itself, as apps/accounts/services.py does for an account it
deactivates, reactivates or deletes, apps/accounts/self_views.py for a
password changed or a session ended, apps/accounts/reauth.py for a password
mistyped to confirm one, and apps/accounts/middleware.py for why it ends a
session, before the logout it signals. A session past the deadline Django
keeps for it is never loaded again, so it signs nobody out and leaves no
line. Nothing else writes to this logger.

A line is the event's name and `key=value` pairs, each value in its `repr`: a
username typed at a failed login is the caller's own text, and quoted it
cannot start a line of its own (a newline prints as `\\n`). The request's id
comes from the console handler's filter (config/request_id.py), as on every
other line. A password never reaches this module: Django blanks it in the
credentials a failed login signals, and no caller passes one.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from django.http import HttpRequest
    from rest_framework.request import Request

log = logging.getLogger(__name__)


class AuthEvent(StrEnum):
    """Every event this log knows; a new member comes with the place that emits it."""

    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    REGISTER = "register"
    DEACTIVATE = "deactivate"
    ACTIVATE = "activate"
    DELETE = "delete"
    EXPIRED = "expired"
    PASSWORD_CHANGED = "password_changed"
    REAUTH_FAILED = "reauth_failed"
    SESSIONS_ENDED = "sessions_ended"


def auth_event(
    event: AuthEvent,
    request: HttpRequest | Request | None,
    user: AbstractBaseUser | None = None,
    **fields: object,
) -> None:
    """Writes one line for `event`: who it concerns, `fields`, and the caller's address.

    The address is `REMOTE_ADDR` alone, for the reason the throttle uses it
    (config/settings.py, `NUM_PROXIES`). `META.get` because a request the test
    client builds for `force_login` has no META entries at all.
    """
    parts: dict[str, object] = {}
    if user is not None:
        parts["user"] = user.pk
        parts["username"] = user.get_username()
    parts.update(fields)
    parts["ip"] = request.META.get("REMOTE_ADDR") if request is not None else None
    log.info("%s %s", event.value, " ".join(f"{key}={value!r}" for key, value in parts.items()))


def logged_in(sender: object, request: HttpRequest, user: AbstractBaseUser, **_: Any) -> None:
    auth_event(AuthEvent.LOGIN, request, user)


def logged_out(
    sender: object, request: HttpRequest, user: AbstractBaseUser | None, **_: Any
) -> None:
    # `user` is None when nobody was signed in: Django signals a logout anyway.
    auth_event(AuthEvent.LOGOUT, request, user)


def login_failed(
    sender: object, credentials: dict[str, Any], request: HttpRequest | None = None, **_: Any
) -> None:
    # Only the username: the rest of `credentials` is what the backend was
    # handed, its password already masked by Django.
    auth_event(AuthEvent.LOGIN_FAILED, request, username=credentials.get("username"))
