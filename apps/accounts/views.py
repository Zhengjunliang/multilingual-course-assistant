"""Account endpoints: who am I, log in, log out, register.

What the holder of a link calls, a reset link or an invitation, is
apps/accounts/link_views.py.

Sessions rather than tokens. The SPA is served from this same origin — by Vite's
proxy in development (frontend/vite.config.ts), by Django itself once there is a
build to serve — so the browser's own cookie jar is the entire mechanism. A JWT
would add a second credential to issue, store, refresh and leak, bought for a
cross-origin problem this project does not have.

**Why `GET /api/auth/me` answers 200 to a stranger.** "Who am I" has an
answer for a stranger too, a flag in the body, and the SPA asks it before
anything else; a refusal there would be logged as one and read by the page as
a session that ended. Elsewhere a request that needs a session and has none is
a 401 `UNAUTHENTICATED`, and a failed CSRF check a 403 `CSRF_FAILED`
(config/errors.py, apps/accounts/authentication.py), so each status has one
meaning.

That endpoint is also the only place the CSRF cookie is issued, and it has to
be: `ensure_csrf_cookie` normally rides on a rendered template, and in
development the page comes from Vite without passing through Django at all. The
SPA calls this first, before anything else, and gets both answers from it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from django.contrib.auth import login, logout
from django.contrib.auth.models import AnonymousUser
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.permissions import AllowAnyWithCsrf
from apps.accounts.serializers import LoginSerializer, RegisterSerializer, UserSerializer

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from rest_framework.permissions import BasePermission
    from rest_framework.request import Request

    from apps.accounts.models import User


def session_body(user: AbstractBaseUser) -> dict[str, object]:
    """The one shape every endpoint here answers with, so the SPA parses one.

    Taken as the abstract base and narrowed by hand because that is what
    `request.user` is to a type checker: django-stubs resolves `AUTH_USER_MODEL`
    through a mypy plugin, and this project checks with pyright, which has none.
    At runtime the class is always this project's `User` — the swap is asserted
    by tests/test_accounts.py.
    """
    return {"authenticated": True, "user": UserSerializer(cast("User", user)).data}


class AddressRateThrottle(ScopedRateThrottle):
    """The view's scope, counted by the caller's address whoever is signed in.

    `ScopedRateThrottle` counts a signed-in caller by account, and signing in
    and registering are open to one: registering signs the new account in, so
    an account a minute would buy a fresh bucket a minute, with as many
    guesses in each.
    """

    def get_cache_key(self, request: Request, view: APIView) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(APIView):
    """`GET` says who is calling; `PATCH` changes their interface language."""

    def get_permissions(self) -> list[BasePermission]:
        # Per method rather than per class: `GET` is how the SPA discovers it is
        # *not* logged in, so requiring a login to ask would be circular. `PATCH`
        # writes to an account and needs one.
        if self.request.method == "PATCH":
            return [IsAuthenticated()]
        return [AllowAny()]

    def get(self, request: Request) -> Response:
        user = request.user
        # `isinstance` rather than the usual `is_authenticated`: they mean the
        # same thing here — one of the two classes is always what `request.user`
        # holds — and only this spelling narrows the type, because
        # `is_authenticated` is a property and pyright does not discriminate a
        # union on one.
        if isinstance(user, AnonymousUser):
            return Response({"authenticated": False, "user": None})
        return Response(session_body(user))

    def patch(self, request: Request) -> Response:
        # `partial` because the only writable field is `locale` and a language
        # switch should not have to echo back the rest of the account. The cast
        # is the same one `session_body` explains.
        serializer = UserSerializer(cast("User", request.user), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"authenticated": True, "user": serializer.data})


class LoginView(APIView):
    # With the token checked, so another site cannot log a visitor's browser
    # into an account of its own and read what they ask next.
    permission_classes = (AllowAnyWithCsrf,)
    throttle_classes = (AddressRateThrottle,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        # Django's own `login`, not a hand-rolled session write: it cycles the
        # session key, which is what stops a session id fixed before the login
        # from surviving into the logged-in one.
        login(request, serializer.validated_data["user"])
        return Response(session_body(serializer.validated_data["user"]))


class LogoutView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RegisterView(APIView):
    # Checked for the reason LoginView is: registering signs the caller in.
    permission_classes = (AllowAnyWithCsrf,)
    throttle_classes = (AddressRateThrottle,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # Django signals a login and not a registration (apps/accounts/events.py).
        auth_event(AuthEvent.REGISTER, request, user)
        # Signed in on the way out. The alternative is a second form asking for
        # the two fields just typed. A user that did not come through
        # `authenticate` carries no backend, and with two configured `login`
        # has to be told which one vouches for them: `ModelBackend`, the one
        # that checks passwords.
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(session_body(user), status=status.HTTP_201_CREATED)
