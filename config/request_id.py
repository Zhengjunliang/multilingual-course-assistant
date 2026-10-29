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
from contextlib import contextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

from django.utils.log import log_response

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from django.http import HttpRequest, HttpResponseBase

# What a line written outside any request carries (a management command, the
# server starting up), so the log format always has its field.
NO_REQUEST = "-"

_current: ContextVar[str] = ContextVar("request_id", default=NO_REQUEST)


def current() -> str:
    """The id of the request this code runs for, or `NO_REQUEST`."""
    return _current.get()


@contextmanager
def serving(request_id: str) -> Iterator[None]:
    """Run as part of request `request_id`, away from it: the task a request
    queued, on a worker (apps/qa/tasks.py), logs under the asker's id and
    reports its failures under it."""
    token = _current.set(request_id)
    try:
        yield
    finally:
        _current.reset(token)


class RequestIdMiddleware:
    """Gives each request its id; first in `MIDDLEWARE`, so other middleware's lines carry it."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        request_id = secrets.token_hex(16)
        token = _current.set(request_id)
        try:
            response = self.get_response(request)
            if response.status_code >= 400:
                # Django logs a failed response itself, but only once the whole
                # middleware chain has returned (`BaseHandler.get_response`),
                # after the reset below; logged here, the line carries the id,
                # and Django skips a response already logged. An `/api/` refusal
                # has been, by its handler (config/errors.py). The stubs narrow
                # `response` to `HttpResponse`; Django passes this same one.
                log_response(
                    "%s: %s",
                    response.reason_phrase,
                    request.path,
                    response=response,  # pyright: ignore[reportArgumentType]
                    request=request,
                )
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
