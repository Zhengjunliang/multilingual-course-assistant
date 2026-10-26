"""The request id: one per request, made by the server, on the response and on every log line.

No `django_db` marker, as in tests/test_spa.py: making and returning an id
reaches no database, and pytest-django refuses any query a test without the
marker attempts. The middleware is driven directly around a view of this
module's own, which logs while the request runs; one test goes through the
client to show the middleware is installed and first.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

import pytest
from django.conf import settings
from django.http import HttpResponse

from config.request_id import NO_REQUEST, RequestIdFilter, RequestIdMiddleware, current

if TYPE_CHECKING:
    from django.http import HttpRequest
    from django.test import Client, RequestFactory

# A W3C Trace Context trace id, the format Langfuse takes (config/request_id.py).
TRACE_ID = re.compile(r"^[0-9a-f]{32}$")

log = logging.getLogger("tests.request_id")


def logging_view(request: HttpRequest) -> HttpResponse:
    """Logs two lines inside the request and answers with the id it ran under."""
    log.warning("first line")
    log.warning("second line")
    return HttpResponse(current())


def failing_view(request: HttpRequest) -> HttpResponse:
    raise RuntimeError(current())


def test_each_response_carries_a_fresh_trace_id(rf: RequestFactory) -> None:
    middleware = RequestIdMiddleware(logging_view)
    first = middleware(rf.get("/"))
    second = middleware(rf.get("/"))

    assert TRACE_ID.match(first["X-Request-ID"])
    assert TRACE_ID.match(second["X-Request-ID"])
    assert first["X-Request-ID"] != second["X-Request-ID"]
    # The view ran under the id the response names.
    assert isinstance(first, HttpResponse)
    assert first.content.decode() == first["X-Request-ID"]


def test_an_incoming_id_is_ignored(rf: RequestFactory) -> None:
    sent_id = "a" * 32
    trace = "b" * 32
    request = rf.get("/", HTTP_X_REQUEST_ID=sent_id, HTTP_TRACEPARENT=f"00-{trace}-{'c' * 16}-01")

    answered = RequestIdMiddleware(logging_view)(request)["X-Request-ID"]

    assert TRACE_ID.match(answered)
    assert answered not in {sent_id, trace}


def test_every_line_of_a_request_carries_its_id(
    rf: RequestFactory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.handler.addFilter(RequestIdFilter())
    with caplog.at_level(logging.WARNING, logger=log.name):
        response = RequestIdMiddleware(logging_view)(rf.get("/"))

    lines = [record for record in caplog.records if record.name == log.name]
    assert [record.getMessage() for record in lines] == ["first line", "second line"]
    assert {getattr(record, "request_id", None) for record in lines} == {response["X-Request-ID"]}


def test_no_id_outlives_its_request(rf: RequestFactory) -> None:
    RequestIdMiddleware(logging_view)(rf.get("/"))
    assert current() == NO_REQUEST

    with pytest.raises(RuntimeError) as raised:
        RequestIdMiddleware(failing_view)(rf.get("/"))
    # The view did run under an id, and a request that raises still lets it go.
    assert TRACE_ID.match(str(raised.value))
    assert current() == NO_REQUEST


def test_the_console_prints_the_id_and_a_dash_outside_a_request() -> None:
    console = next(
        handler
        for handler in logging.getLogger().handlers
        if any(isinstance(f, RequestIdFilter) for f in handler.filters)
    )
    record = logging.makeLogRecord({"msg": "outside", "levelname": "INFO", "name": "somewhere"})

    assert console.filter(record)
    assert f"[{NO_REQUEST}] somewhere: outside" in console.format(record)


def test_the_middleware_is_installed_first(client: Client) -> None:
    assert settings.MIDDLEWARE[0] == "config.request_id.RequestIdMiddleware"
    # A path no app owns: Django's own 404, answered without the database.
    assert TRACE_ID.match(client.get("/api/typo")["X-Request-ID"])
