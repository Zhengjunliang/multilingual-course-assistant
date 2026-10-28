"""How long a signed-in session lives: an idle limit and an absolute one, by tier.

`SESSION_LIFETIMES` (config/settings.py) gives each tier its two limits and
the reasons for them. Most of the work is Django's: each refresh moves the
session's expiry (`extend`, apps/accounts/sessions.py), and Django loads no
session past it, so the device list, `clearsessions` and this middleware read
one deadline. This adds what Django cannot do:

- the absolute limit, counted from the sign-in however busy the session is;
- the tier, read afresh on every request: a role granted mid-session holds
  the session to staff's limits from its next request, not its next sign-in;
- the idle limit checked against the session's own record of when it was
  last seen, which a tier changed since the last refresh would not show in
  its expiry.

A refresh writes the session, so it waits a minute after the last one
(django-session-timeout's grace, outside the repository): a busy session is
written once a minute at most, and its idle limit may run out a minute early.
A changed tier is refreshed at once. A streamed answer is checked as it
starts, as any request is; its session is saved before the stream runs.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.auth.models import AnonymousUser

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.sessions import AUTH_AT, SEEN_AT, TIER, extend, tier_of

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.contrib.auth.base_user import AbstractBaseUser
    from django.http import HttpRequest
    from django.http.response import HttpResponseBase

REFRESH_GRACE_SECONDS = 60


class SessionLifetimeMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        # `isinstance` for the reason SessionView.get gives (apps/accounts/views.py).
        if not isinstance(request.user, AnonymousUser):
            self.hold_to_limits(request, request.user)
        return self.get_response(request)

    def hold_to_limits(self, request: HttpRequest, user: AbstractBaseUser) -> None:
        """Refreshes the session if it is within its limits, signs it out if not."""
        session = request.session
        now = int(time.time())
        tier = tier_of(user)
        idle, absolute = settings.SESSION_LIFETIMES[tier]
        signed_in, seen = session.get(AUTH_AT), session.get(SEEN_AT)
        if signed_in is None or seen is None:
            # Not written by a sign-in (apps/accounts/sessions.py, `stamp`):
            # nothing says how old it is, so it is as old as can be.
            reason = "unstamped"
        elif now - signed_in >= absolute:
            reason = "absolute"
        elif now - seen >= idle:
            reason = "idle"
        else:
            if session.get(TIER) != tier or now - seen >= REFRESH_GRACE_SECONDS:
                extend(session, tier, now)
            return
        auth_event(AuthEvent.EXPIRED, request, user, reason=reason)
        logout(request)
