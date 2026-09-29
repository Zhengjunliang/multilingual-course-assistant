"""DRF glue for scoped permissions: the scope first, then the permission, then the body.

A view on one scope — an edition, a programme — answers in a fixed order: a
scope the caller may not see is missing (404), a visible scope on which the
caller lacks the permission is forbidden (403), and only then is the request
body read (400). The order is what keeps a caller from probing: without it, a
student could learn which usernames exist from the 400 a body check gives
before the scope is looked at.

`ScopedObjectView` makes the order structural rather than a convention each
handler has to follow: it resolves the scope in `initial()`, before any handler
runs, and handlers read `self.scope`. DRF only checks object permissions inside
`get_object()`, so a handler that forgot to call it would otherwise skip the
check without anyone noticing.

Which permission a method needs is the view's `scope_map`, as in Sentry's
`OrganizationPermission.scope_map`.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, Any, cast

from django.db.models import Model
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import BasePermission, IsAuthenticated

if TYPE_CHECKING:
    from collections.abc import Mapping

    from rest_framework.request import Request
    from rest_framework.views import APIView

    from apps.accounts.models import User
    from apps.roles.registry import Permission


class HasScopedPermission(BasePermission):
    """The caller holds, on the object, the permission the view maps this method to.

    HEAD and OPTIONS need what GET needs. A method missing from the map is
    refused, so a view that forgets an entry fails closed.
    """

    def has_object_permission(self, request: Request, view: APIView, obj: Any) -> bool:
        method = "GET" if request.method in ("HEAD", "OPTIONS") else request.method
        permission = cast("Mapping[str, Permission]", getattr(view, "scope_map", {})).get(
            method or ""
        )
        # Past IsAuthenticated, so this project's user; the cast is the one
        # apps/accounts/views.py explains.
        return permission is not None and cast("User", request.user).has_perm(permission, obj)


class ScopedObjectView[M: Model](GenericAPIView[M]):
    """A view on one scope, resolved before any handler runs.

    Subclasses give `get_queryset()` — the scopes the caller may see — and
    `scope_map`; handlers read `self.scope`. Empty rather than absent, so a
    view that declares no map refuses every method with a 403 instead of
    failing with a 500.
    """

    permission_classes = (IsAuthenticated, HasScopedPermission)
    scope_map: Mapping[str, Permission] = MappingProxyType({})
    scope: M

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        super().initial(request, *args, **kwargs)
        # The same test DRF's dispatch makes: a method the view does not
        # implement gets its 405, with no scope looked up first.
        method = (request.method or "").lower()
        if method in self.http_method_names and hasattr(self, method):
            self.scope = self.get_object()
