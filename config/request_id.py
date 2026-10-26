"""Each request's id: in the response's `X-Request-ID` and on every log line it causes.

The id is what ties a reader's error to the server's account of it: the page
shows it beside an unexpected error, and the developer finds that request's
lines by it. It takes the format of a W3C Trace Context trace id, 32 lowercase
hex characters, which is what Langfuse takes as a trace id (#26), so the same
id can name the request's trace there.

The server makes the id and never takes one from the request. No trusted proxy
stands in front of this server (config/settings.py reads the client's address
alone, for the same reason), so honouring an incoming `X-Request-ID` or
`traceparent` would let any caller choose the id its lines are filed under, or
write into the log through a header.
"""

from __future__ import annotations

import logging
import secrets
from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponseBase

# What a line written outside any request carries (a management command, the
# server starting up), so the log format always has its field.
NO_REQUEST = "-"

_current: ContextVar[str] = ContextVar("request_id", default=NO_REQUEST)


def current() -> str:
    """The id of the request this code runs for, or `NO_REQUEST`."""
    return _current.get()


class RequestIdMiddleware:
    """Gives each request its id; first in `MIDDLEWARE`, so other middleware's lines carry it."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        request_id = secrets.token_hex(16)
        token = _current.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            # Without the reset, the next request this thread serves would log
            # under this id until its own middleware ran.
            _current.reset(token)
        response["X-Request-ID"] = request_id
        return response


class RequestIdFilter(logging.Filter):
    """Puts the current request's id on each record as `request_id`, for the log format to print.

    A filter on the handler rather than on a logger: a logger's filters do not
    see the records its children propagate up to it, a handler's see them all.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = current()
        return True
