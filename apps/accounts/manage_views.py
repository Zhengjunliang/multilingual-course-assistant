"""The accounts, managed by a superuser from the site: listed, deactivated, reactivated,
signed out, deleted, and given a link that resets the password.

The site's door to what `/admin/` also does (apps/accounts/admin.py), and
through the same rules: each change goes through apps/accounts/services.py,
which refuses taking away the caller's own access and deleting an account
still active, and logs what it did. A reset link, which `/admin/` does not
make, comes from apps/accounts/links.py, and not for the caller's own
account either. Shaped as GitLab's user administration (outside the
repository: its REST API documentation, "Users"): an action is a `POST` to a
path of its own under the account, and deleting is the account's `DELETE`.

No password is asked again, as `/admin/` asks none: a superuser's session is
held to staff's limits, an hour idle (apps/accounts/middleware.py), and each
change here can be undone but deleting, which only an account deactivated
first can come to.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import links, services
from apps.accounts.manage_serializers import (
    ROLE_ROWS,
    ManagedUserSerializer,
    ResetLinkSerializer,
)
from apps.accounts.models import User
from apps.accounts.permissions import IsSuperuser
from apps.roles.models import RoleAssignment
from apps.roles.scopes import ROLE_ORDER

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.db.models import QuerySet
    from rest_framework.request import Request

    type Change = Callable[[User, User, services.Caller], None]

SUPERUSERS = (IsAuthenticated, IsSuperuser)

# The values `?active=` filters on.
ACTIVE = {"true": True, "false": False}


class UserPagination(PageNumberPagination):
    # A page a superuser reads down; searching is how one account is found.
    page_size = 50


class UserListView(ListAPIView[User]):
    """`GET`: every account by username, `?q=` a part of it, `?active=true|false`."""

    permission_classes = SUPERUSERS
    serializer_class = ManagedUserSerializer
    pagination_class = UserPagination

    def get_queryset(self) -> QuerySet[User]:
        roles = RoleAssignment.objects.select_related("programme").order_by(*ROLE_ORDER)
        users = User.objects.order_by("username").prefetch_related(
            Prefetch("role_assignments", queryset=roles, to_attr=ROLE_ROWS)
        )
        # A value no account can match narrows to nothing, as
        # apps/catalog/views.py narrows an unknown course: a NUL byte too,
        # which PostgreSQL refuses with an error.
        query = self.request.query_params.get("q")
        if query:
            users = users.filter(username__icontains=query) if "\0" not in query else users.none()
        active = self.request.query_params.get("active")
        if active is not None:
            users = users.filter(is_active=ACTIVE[active]) if active in ACTIVE else users.none()
        return users


def change(request: Request, pk: int, make: Change) -> Response:
    """Makes the change on the account `pk` names, as the caller: a 204, or the rule it breaks."""
    user = get_object_or_404(User, pk=pk)
    try:
        # Past `SUPERUSERS`, so this project's user; the cast is the one
        # `session_body` explains (apps/accounts/views.py).
        make(cast("User", request.user), user, request)
    except services.AccountRuleError as exc:
        services.refuse(exc.rule)
    return Response(status=status.HTTP_204_NO_CONTENT)


def reactivate(actor: User, user: User, request: services.Caller) -> None:
    # An active account has nothing to undo, and reactivating it would end
    # its sessions (`services.activate`).
    if not user.is_active:
        services.activate(actor, user, request)


class UserView(APIView):
    """`DELETE`: deletes a deactivated account, its conversations with it."""

    permission_classes = SUPERUSERS

    def delete(self, request: Request, pk: int) -> Response:
        return change(request, pk, services.delete_account)


class DeactivateView(APIView):
    """`POST`: deactivates the account and ends every session of it."""

    permission_classes = SUPERUSERS

    def post(self, request: Request, pk: int) -> Response:
        return change(request, pk, services.deactivate)


class ActivateView(APIView):
    """`POST`: reactivates the account, which signs in afresh."""

    permission_classes = SUPERUSERS

    def post(self, request: Request, pk: int) -> Response:
        return change(request, pk, reactivate)


class EndSessionsView(APIView):
    """`POST`: ends every session of the account, which stays active."""

    permission_classes = SUPERUSERS

    def post(self, request: Request, pk: int) -> Response:
        return change(request, pk, services.sign_out)


class ResetLinkView(APIView):
    """`POST`: a link that sets the account's password, voiding any before it (201).

    The token is in this answer and nowhere else: the superuser hands the link
    over, and a lost one is replaced by making another.
    """

    permission_classes = SUPERUSERS

    def post(self, request: Request, pk: int) -> Response:
        user = get_object_or_404(User, pk=pk)
        try:
            token, expires_at = links.make_reset_link(cast("User", request.user), user, request)
        except services.AccountRuleError as exc:
            services.refuse(exc.rule)
        body = ResetLinkSerializer({"token": token, "expires_at": expires_at}).data
        return Response(body, status=status.HTTP_201_CREATED)
