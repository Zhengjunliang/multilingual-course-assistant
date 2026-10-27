"""Who a request is from: its session, with a failed CSRF check refused by its own code."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from rest_framework.authentication import CSRFCheck, SessionAuthentication

from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse
    from rest_framework.request import Request

logger = logging.getLogger(__name__)


def _not_run(request: HttpRequest) -> HttpResponse:
    """The next step and the view a middleware is given; only the check's own hooks run here."""
    raise NotImplementedError


class CodedSessionAuthentication(SessionAuthentication):
    """DRF's session authentication, refusing a failed CSRF check as `CSRF_FAILED`.

    DRF refuses it as `PermissionDenied`, which reads as `PERMISSION_DENIED`: the
    page would tell the reader they may not do what they may, when what they
    need is to reload it for a fresh token. The check is the one DRF runs
    (`SessionAuthentication.enforce_csrf`): Django's own middleware, through
    `CSRFCheck`, which returns its reason instead of answering with a page.
    """

    def enforce_csrf(self, request: Request) -> None:
        check = CSRFCheck(_not_run)
        # Puts the cookie's token in `request.META`, where the comparison reads it.
        check.process_request(request)
        # As the view, `_not_run` is not `csrf_exempt`: the check applies.
        reason = check.process_view(request, _not_run, (), {})
        if reason:
            # Django's reason (no cookie, no token, a foreign origin) is for the
            # developer; the body carries the code alone.
            logger.info("CSRF check failed: %s", reason)
            fail(ErrorCode.CSRF_FAILED)
