"""What a link's holder calls: a reset link's, to set a password, and an invitation's, to accept it.

The holder of a reset link is signed out, and an invitation's may have no
account yet, so every endpoint here is open, the token in the body the only
credential (apps/accounts/links.py). Each is checked for the CSRF token as
logging in is, and counted with it: NIST throttles a recovery code as it does
a password (SP 800-63B-4, section 4.2.1.2, outside the repository). Each
looks the link up with a `POST`, though it reads: the token goes in a body,
where no log reads it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from django.contrib.auth import login
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.links import reset_link_owner, reset_password
from apps.accounts.permissions import AllowAnyWithCsrf
from apps.accounts.serializers import (
    InvitedAccountSerializer,
    LinkSerializer,
    PasswordResetSerializer,
)
from apps.accounts.views import AddressRateThrottle, session_body
from apps.catalog.invitation_serializers import InvitationGrantSerializer
from apps.roles.invitations import accept, invitation_for
from config.errors import django_field_error

if TYPE_CHECKING:
    from rest_framework.request import Request

    from apps.accounts.models import User


class _LinkView(APIView):
    permission_classes = (AllowAnyWithCsrf,)
    throttle_classes = (AddressRateThrottle,)
    throttle_scope = "auth"


class ResetLookupView(_LinkView):
    """`POST`: the username a reset link's token resets, for the page to name; the link stays."""

    def post(self, request: Request) -> Response:
        serializer = LinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = reset_link_owner(serializer.validated_data["token"])
        return Response({"username": user.get_username()})


class ResetView(_LinkView):
    """`POST`: sets the password a reset link resets, and signs the account out everywhere (204)."""

    def post(self, request: Request) -> Response:
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reset_password(
                serializer.validated_data["token"],
                serializer.validated_data["new_password"],
                request,
            )
        except DjangoValidationError as exc:
            raise django_field_error(exc, field="new_password") from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class InvitationLookupView(_LinkView):
    """`POST`: the role and the scope an invitation's token makes its holder staff of; it stays."""

    def post(self, request: Request) -> Response:
        serializer = LinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation = invitation_for(serializer.validated_data["token"])
        return Response(InvitationGrantSerializer(invitation).data)


class InvitationAcceptView(_LinkView):
    """`POST`: accepts an invitation, as the account signed in (200) or as one it makes (201).

    Signed in, the body is the token alone. Signed out, it names the account
    to make as registering does, and its fields are checked before the
    invitation is looked at, so a username taken or a password refused leaves
    the link working; the account made is signed in, as registering signs one
    in. Either way the answer is `me`'s, now naming the role.
    """

    def post(self, request: Request) -> Response:
        # `isinstance` for the reason `SessionView.get` gives (apps/accounts/views.py).
        if not isinstance(request.user, AnonymousUser):
            link = LinkSerializer(data=request.data)
            link.is_valid(raise_exception=True)
            user = cast("User", request.user)
            accept(link.validated_data["token"], user, request)
            # A new key for a session that now holds a role, as the OWASP
            # Session Management Cheat Sheet asks on any change of privilege
            # (outside the repository); it stays signed in.
            request.session.cycle_key()
            return Response(session_body(user))
        serializer = InvitedAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        accept(serializer.validated_data["token"], user, request)
        # The backend `RegisterView` names, for the reason it gives.
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(session_body(user), status=status.HTTP_201_CREATED)
