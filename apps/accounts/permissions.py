"""Who may call an endpoint, where DRF's own permission classes do not say it."""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework.permissions import BasePermission

from apps.accounts.authentication import CodedSessionAuthentication

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView


class AllowAnyWithCsrf(BasePermission):
    """Anyone may call, and a caller without a session still needs the CSRF token.

    `SessionAuthentication` checks the token only once it has found a logged-in
    user (rest_framework/authentication.py): with nobody to authenticate it
    returns before the check, and DRF's documentation tells a login view to add
    its own. Under `AllowAny` an anonymous POST would go unchecked, so a form on
    any other site could submit it from a visitor's browser, on the visitor's
    address and the visitor's rate limit.

    The check is the authentication class's own, called rather than copied, so a
    refusal is the `CSRF_FAILED` a logged-in caller gets. A caller DRF did
    authenticate is left to the class that admitted it, as on every other
    endpoint. Safe methods pass untouched: Django's
    `CsrfViewMiddleware.process_view`, which the check runs, lets them through.
    """

    def has_permission(self, request: Request, view: APIView) -> bool:
        if not request.user.is_authenticated:
            CodedSessionAuthentication().enforce_csrf(request)
        return True


class IsSuperuser(BasePermission):
    """The caller is a superuser, and after `IsAuthenticated` an active one.

    DRF's own `IsAdminUser` asks `is_staff`, which here only lets a superuser
    through the admin's login form (config/admin.py) and never follows from a
    role (docs/decisions.md, 2026-09-29, *Staff permissions are a registry in
    code, answered by one backend; the admin is the superuser's*, point 3).
    """

    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(getattr(request.user, "is_superuser", False))
