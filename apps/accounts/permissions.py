"""Who may call an endpoint, where DRF's own permission classes do not say it."""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import BasePermission

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

    The check is DRF's own, called rather than copied, so a refusal is the 403 a
    logged-in caller gets, in the same words. A caller DRF did authenticate is
    left to the class that admitted it, as on every other endpoint. Safe methods
    pass untouched: Django's `CsrfViewMiddleware.process_view`, which the check
    runs, lets them through.
    """

    def has_permission(self, request: Request, view: APIView) -> bool:
        if not request.user.is_authenticated:
            SessionAuthentication().enforce_csrf(request)
        return True
