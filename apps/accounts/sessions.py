"""The session engine (`SESSION_ENGINE`): Django's database store, each row keyed to its account.

Django's own table holds a session's data only as an encoded blob, so
finding an account's sessions means decoding every row. This engine saves
each into `AccountSession` (apps/accounts/models.py), whose columns name the
account and the device: ending every session of an account is one indexed
`DELETE`, and deleting the account deletes its sessions with it (`CASCADE`),
whichever path deleted it.

The columns are a projection of the session's data and nothing else:
`DBStore.save` rewrites the whole row on every save, so a column written any
other way would be overwritten by the next one. What a column needs goes into
the data, at sign-in (`stamp`).
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

from django.contrib.auth import SESSION_KEY
from django.contrib.sessions.backends.db import SessionStore as DBStore

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from django.http import HttpRequest

    from apps.accounts.models import AccountSession

# The keys this engine reads off a session's data. Times are whole seconds
# since the epoch: the data is JSON, which has no datetime.
AUTH_AT = "auth_at"
SEEN_AT = "seen_at"
USER_AGENT = "ua"
IP = "ip"

# Longer than any browser's `User-Agent` in practice; a longer header is the
# caller's own text, and is cut rather than stored whole.
USER_AGENT_MAX_LENGTH = 256


class SessionStore(DBStore):
    @classmethod
    def get_model_class(cls) -> type[AccountSession]:  # pyright: ignore[reportIncompatibleMethodOverride]
        # Imported here, as Django's own store does: this module is imported
        # by apps/accounts/apps.py before the models are ready.
        from apps.accounts.models import AccountSession

        return AccountSession

    def create_model_instance(self, data: dict[str, Any]) -> AccountSession:
        session = cast("AccountSession", super().create_model_instance(data))
        # The account's key, which `login()` stores as a string; none in a
        # session nobody signed in to.
        key = data.get(SESSION_KEY)
        session.user_id = None if key is None else int(key)
        session.user_agent = data.get(USER_AGENT, "")
        session.ip = data.get(IP)
        session.authenticated_at = moment(data.get(AUTH_AT))
        session.last_activity = moment(data.get(SEEN_AT))
        return session


def moment(seconds: int | None) -> datetime | None:
    return None if seconds is None else datetime.fromtimestamp(seconds, tz=UTC)


def end_sessions(user: AbstractBaseUser, keep: str | None = None) -> int:
    """Ends every session of `user` but the one keyed `keep`; returns how many ended.

    The rows are deleted, not marked: a request still carrying one of their
    cookies finds no session and is nobody's.
    """
    sessions = SessionStore.get_model_class().objects.filter(user=user.pk)
    if keep is not None:
        sessions = sessions.exclude(session_key=keep)
    ended, _ = sessions.delete()
    return ended


def stamp(sender: object, request: HttpRequest, user: AbstractBaseUser, **_: Any) -> None:
    """At every sign-in (`user_logged_in`), writes what the session's columns show.

    Unconditionally: signing in again as the account already signed in keeps
    the session's data (`login()` only changes its key), and the time of the
    earlier sign-in would otherwise stay. `META.get` because the request the
    test client builds for `force_login` has no META entries at all.
    """
    now = int(time.time())
    request.session[AUTH_AT] = now
    request.session[SEEN_AT] = now
    request.session[USER_AGENT] = request.META.get("HTTP_USER_AGENT", "")[:USER_AGENT_MAX_LENGTH]
    request.session[IP] = request.META.get("REMOTE_ADDR")
