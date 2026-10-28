"""What the signed-in caller does to their own account: change the password, see and end
sessions, delete it.

Each change asks for the password first (apps/accounts/reauth.py), at the
login's rate (`throttle_scope`). Ending sessions goes through `end_sessions`
(apps/accounts/sessions.py), the one function that does, deleting through
the rules of apps/accounts/services.py, and each change leaves its line in
the authentication log.

A session is named by its `public_id`, never by its key, which is the cookie
itself. The caller's own session is listed and marked, but not ended here:
signing out ends it, and an id naming it is a 404 like any other id the
caller holds no session under.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from django.contrib.auth import update_session_auth_hash
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.events import AuthEvent, auth_event
from apps.accounts.models import AccountSession
from apps.accounts.passwords import set_password_checked
from apps.accounts.reauth import require_password
from apps.accounts.serializers import (
    AccountSessionSerializer,
    DeleteAccountSerializer,
    EndSessionsSerializer,
    PasswordChangeSerializer,
)
from apps.accounts.services import AccountRuleError, delete_own_account, refuse
from apps.accounts.sessions import end_sessions
from config.errors import ErrorCode, django_field_error, fail

if TYPE_CHECKING:
    from rest_framework.request import Request

    from apps.accounts.models import User

# The `session` that ends every session of the account but the caller's.
OTHERS = "others"


class PasswordView(APIView):
    """`POST`: the password changes, and every other session of the account ends (ASVS 7.4.3)."""

    permission_classes = (IsAuthenticated,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # The cast `session_body` explains (apps/accounts/views.py).
        user = cast("User", request.user)
        require_password(request, user, serializer.validated_data["password"])
        try:
            set_password_checked(user, serializer.validated_data["new_password"])
        except DjangoValidationError as exc:
            raise django_field_error(exc, field="new_password") from exc
        user.save(update_fields=["password"])
        # Keeps this session signed in under the new password, with a new key;
        # the others no longer match it, and are deleted below rather than
        # left in the list until they are next used.
        update_session_auth_hash(request, user)
        ended = end_sessions(user, keep=request.session.session_key)
        auth_event(AuthEvent.PASSWORD_CHANGED, request, user, sessions=ended)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionsView(APIView):
    """`GET`: the account's sessions still alive, the most recently used first (ASVS 7.5.2)."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        # Alive as Django reads a session: its expiry not reached
        # (`_get_session_from_db`), which a refresh moves (apps/accounts/sessions.py).
        sessions = AccountSession.objects.filter(
            user=request.user.pk, expire_date__gt=timezone.now()
        ).order_by("-last_activity", "session_key")
        context = {"current": request.session.session_key}
        return Response(AccountSessionSerializer(sessions, many=True, context=context).data)


class EndSessionsView(APIView):
    """`POST`: ends one session of the account, or every one but the caller's."""

    permission_classes = (IsAuthenticated,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = EndSessionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = cast("User", request.user)
        require_password(request, user, serializer.validated_data["password"])
        session = serializer.validated_data["session"]
        current = request.session.session_key
        if session == OTHERS:
            ended = end_sessions(user, keep=current)
        elif not (ended := end_sessions(user, keep=current, only=session)):
            fail(ErrorCode.NOT_FOUND)
        auth_event(AuthEvent.SESSIONS_ENDED, request, user, session=session, ended=ended)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeleteAccountView(APIView):
    """`POST`: deletes the caller's account, its conversations with it, and signs it out.

    A `POST` to its own path and not a `DELETE` of `me`: the password goes in
    the body, and a `DELETE` with a body has no meaning a proxy has to keep
    (RFC 9110, section 9.3.5, outside the repository).
    """

    permission_classes = (IsAuthenticated,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = DeleteAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = cast("User", request.user)
        require_password(request, user, serializer.validated_data["password"])
        try:
            delete_own_account(user, request)
        except AccountRuleError as exc:
            refuse(exc.rule)
        return Response(status=status.HTTP_204_NO_CONTENT)
