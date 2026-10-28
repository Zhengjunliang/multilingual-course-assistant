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

import hashlib
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

from django.conf import settings
from django.contrib.auth import SESSION_KEY
from django.contrib.sessions.backends.db import SessionStore as DBStore

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from django.contrib.sessions.backends.base import SessionBase
    from django.http import HttpRequest

    from apps.accounts.models import AccountSession, User

# The keys this engine reads off a session's data. Times are whole seconds
# since the epoch: the data is JSON, which has no datetime.
AUTH_AT = "auth_at"
SEEN_AT = "seen_at"
TIER = "tier"
USER_AGENT = "ua"
IP = "ip"

# The tiers of `SESSION_LIFETIMES` (config/settings.py).
STAFF = "staff"
STUDENT = "student"

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


def public_id(session_key: str) -> str:
    """A session's name outside the server, where its key never goes.

    The key is the cookie that signs a device in: a list of them in a body
    would hand every device's session to whatever script can read that page.
    """
    return hashlib.sha256(session_key.encode()).hexdigest()


def end_sessions(user: AbstractBaseUser, keep: str | None = None, only: str | None = None) -> int:
    """Ends the sessions of `user`, or the one whose `public_id` is `only`; returns how many.

    The one keyed `keep` is never ended. The rows are deleted, not marked: a
    request still carrying one of their cookies finds no session and is
    nobody's.
    """
    sessions = SessionStore.get_model_class().objects.filter(user=user.pk)
    if keep is not None:
        sessions = sessions.exclude(session_key=keep)
    if only is not None:
        keys = sessions.values_list("session_key", flat=True)
        sessions = sessions.filter(session_key__in=[key for key in keys if public_id(key) == only])
    ended, _ = sessions.delete()
    return ended


def tier_of(user: AbstractBaseUser) -> str:
    """Staff are the superusers and whoever holds a role (apps/roles/); the rest are students."""
    # Imported here: apps.roles builds on this app's models.
    from apps.roles.models import RoleAssignment

    if cast("User", user).is_superuser or RoleAssignment.objects.filter(user=user.pk).exists():
        return STAFF
    return STUDENT


def extend(session: SessionBase, tier: str, now: int) -> None:
    """Marks the session seen at `now` under `tier`, its expiry the nearer of the tier's limits.

    The idle limit counts from `now`, the absolute one from the sign-in.
    Django keeps the expiry as the row's `expire_date` and loads no row past
    it. Set as a moment and not as a number of seconds, which Django counts
    afresh from every save: a save for any other reason would carry the
    expiry past the absolute deadline.
    """
    idle, absolute = settings.SESSION_LIFETIMES[tier]
    session[SEEN_AT] = now
    session[TIER] = tier
    session.set_expiry(datetime.fromtimestamp(min(now + idle, session[AUTH_AT] + absolute), tz=UTC))


def stamp(sender: object, request: HttpRequest, user: AbstractBaseUser, **_: Any) -> None:
    """At every sign-in (`user_logged_in`), writes what the session's columns show.

    Unconditionally: signing in again as the account already signed in keeps
    the session's data (`login()` only changes its key), and the time of the
    earlier sign-in would otherwise stay. The expiry is the tier's from the
    start, so the first stretch after signing in is held to the idle limit
    too. `META.get` because the request the test client builds for
    `force_login` has no META entries at all.
    """
    now = int(time.time())
    request.session[AUTH_AT] = now
    request.session[USER_AGENT] = request.META.get("HTTP_USER_AGENT", "")[:USER_AGENT_MAX_LENGTH]
    request.session[IP] = request.META.get("REMOTE_ADDR")
    extend(request.session, tier_of(user), now)
