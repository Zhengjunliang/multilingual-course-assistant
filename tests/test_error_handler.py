"""Every error of an `/api/` view, answered in the coded body (`api_exception_handler`).

Each exception is raised inside a DRF view, as the API's own are, and read off
the response the view returns: the status and headers a caller gets, and the
line the developer finds in the log. An `/api/` path no view has, and a 500 no
view answered, are answered in the same body (config/views.py).
"""

from __future__ import annotations

import importlib
import json
import logging
import pkgutil
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import pytest
from django.conf import settings
from django.core.exceptions import (
    BadRequest,
    SuspiciousOperation,
    TooManyFieldsSent,
)
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, serializers
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView
from test_error_contract import refused

import apps
from config.errors import (
    CHALLENGE,
    EXCEPTION_MAP,
    FIELD_MAP,
    SPEC,
    THROTTLE_WINDOW_SECONDS,
    ErrorCode,
    FieldReason,
    django_field_error,
    field_error,
)
from config.views import server_error

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from django.test import RequestFactory
    from rest_framework.request import Request
    from rest_framework.response import Response

# One of each class `EXCEPTION_MAP` names, as the API meets it.
RAISED: dict[type[Exception], Exception] = {
    exceptions.ParseError: exceptions.ParseError(),
    SuspiciousOperation: TooManyFieldsSent(),
    BadRequest: BadRequest(),
    exceptions.ValidationError: exceptions.ValidationError({"title": ["Required."]}),
    exceptions.NotAuthenticated: exceptions.NotAuthenticated(),
    exceptions.AuthenticationFailed: exceptions.AuthenticationFailed(),
    exceptions.PermissionDenied: exceptions.PermissionDenied(),
    DjangoPermissionDenied: DjangoPermissionDenied(),
    exceptions.NotFound: exceptions.NotFound(),
    Http404: Http404(),
    exceptions.MethodNotAllowed: exceptions.MethodNotAllowed("PUT"),
    exceptions.NotAcceptable: exceptions.NotAcceptable(),
    exceptions.UnsupportedMediaType: exceptions.UnsupportedMediaType("text/plain"),
    exceptions.Throttled: exceptions.Throttled(wait=5),
}


def answered(refuse: Callable[[], object]) -> Response:
    """What a view that calls `refuse` answers."""

    class Refusing(APIView):
        authentication_classes = ()
        permission_classes = ()

        def get(self, request: Request) -> Response:
            refuse()
            raise AssertionError("refuse() returned")

    return Refusing.as_view()(APIRequestFactory().get("/api/probe"))


def raising(exc: Exception) -> Callable[[], object]:
    def refuse() -> object:
        raise exc

    return refuse


def error_of(response: Response) -> dict[str, Any]:
    return response.data["error"]  # pyright: ignore[reportOptionalSubscript]


def test_every_class_the_map_names_is_raised_here() -> None:
    assert set(RAISED) == {kind for kind, _ in EXCEPTION_MAP}


@pytest.mark.parametrize(
    ("kind", "code"), EXCEPTION_MAP, ids=[c.__name__ for c, _ in EXCEPTION_MAP]
)
def test_each_exception_answers_its_code_with_that_codes_status(
    kind: type[Exception], code: ErrorCode
) -> None:
    response = answered(raising(RAISED[kind]))

    assert (response.status_code, error_of(response)["code"]) == (SPEC[code].status, code)


def test_the_message_is_the_codes_never_the_exceptions() -> None:
    response = answered(raising(exceptions.PermissionDenied("Only the dean may do this.")))

    assert error_of(response)["message"] == "The signed-in user may not do this."


def test_the_message_stays_english_whatever_language_the_caller_asks_for() -> None:
    """DRF's own sentences are translated, and Italian is the site's default
    language; the body's message is the code's English one all the same."""
    response = APIClient().get("/api/conversations", HTTP_ACCEPT_LANGUAGE="it")

    assert error_of(response)["message"] == SPEC[ErrorCode.UNAUTHENTICATED].message


def test_a_body_django_will_not_parse_is_malformed_not_a_500() -> None:
    """Past `DATA_UPLOAD_MAX_NUMBER_FIELDS` Django raises `TooManyFieldsSent`, a
    `SuspiciousOperation`, and the CSRF check reads a form body before anything
    else runs, the throttle included."""
    client = APIClient(enforce_csrf_checks=True)
    client.cookies["csrftoken"] = "a" * 32
    fields = {f"f{n}": "x" for n in range(settings.DATA_UPLOAD_MAX_NUMBER_FIELDS + 1)}

    response = client.post(
        "/api/auth/login", urlencode(fields), content_type="application/x-www-form-urlencoded"
    )

    assert (response.status_code, refused(response)) == (400, ("MALFORMED_REQUEST", {}))


def test_an_exception_nothing_names_is_a_500_whose_traceback_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.ERROR, logger="config.errors"):
        response = answered(raising(RuntimeError("the database said no")))

    assert (response.status_code, error_of(response)["code"]) == (500, "INTERNAL")
    assert "the database said no" not in json.dumps(response.data)
    [line] = [record for record in caplog.records if record.name == "config.errors"]
    assert line.levelno == logging.ERROR
    assert line.exc_info is not None
    assert line.exc_info[0] is RuntimeError


def test_a_caller_not_signed_in_gets_a_401_with_its_challenge() -> None:
    """DRF answers a 403 when the first authentication class offers no challenge,
    as `SessionAuthentication` does; the status is the code's all the same."""
    response = APIClient().get("/api/conversations")

    assert (response.status_code, refused(response)) == (401, ("UNAUTHENTICATED", {}))
    assert response["WWW-Authenticate"] == CHALLENGE


@pytest.mark.parametrize(("wait", "seconds"), [(12.2, 13), (None, THROTTLE_WINDOW_SECONDS)])
def test_a_throttled_request_says_how_long_to_wait(wait: float | None, seconds: int) -> None:
    response = answered(raising(exceptions.Throttled(wait=wait)))

    assert (response["Retry-After"], error_of(response)["data"]) == (
        str(seconds),
        {"retry_after_seconds": seconds},
    )


def odd(value: str) -> None:
    raise exceptions.ValidationError("Not like that.", code="not_like_that")


class Book(serializers.Serializer):
    title = serializers.CharField(max_length=3)
    year = serializers.IntegerField(min_value=1900, max_value=2100)
    tag = serializers.CharField(validators=[odd], required=False)


class Whole(serializers.Serializer):
    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        raise exceptions.ValidationError("Not as a whole.")


def violations(serializer: serializers.Serializer) -> list[tuple[str | None, str, dict]]:
    response = answered(lambda: serializer.is_valid(raise_exception=True))
    error = error_of(response)
    assert (response.status_code, error["code"]) == (400, "INVALID_ARGUMENT")
    return [(each["field"], each["reason"], each["data"]) for each in error["fields"]]


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"title": "long", "year": 2000}, ("title", "TOO_LONG", {"max_length": 3})),
        ({"title": "ok", "year": 1800}, ("year", "TOO_SMALL", {"min_value": 1900})),
        ({"title": "ok", "year": 2200}, ("year", "TOO_LARGE", {"max_value": 2100})),
        ({"year": 2000}, ("title", "REQUIRED", {})),
    ],
    ids=["too-long", "too-small", "too-large", "required"],
)
def test_a_fields_bound_is_read_off_the_field_when_drf_gave_none(
    data: dict[str, object], expected: tuple[str, str, dict]
) -> None:
    assert violations(Book(data=data)) == [expected]


def test_a_code_no_row_names_reads_as_invalid_and_says_so_in_the_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="config.errors"):
        found = violations(Book(data={"title": "ok", "year": 2000, "tag": "x"}))

    assert found == [("tag", "INVALID", {})]
    assert any("not_like_that" in record.getMessage() for record in caplog.records)


def test_an_error_of_the_object_as_a_whole_names_no_field() -> None:
    assert violations(Whole(data={})) == [(None, "INVALID", {})]


def test_djangos_validators_say_why_by_their_codes() -> None:
    rejected = DjangoValidationError(
        [
            DjangoValidationError(
                "Too short.", code="password_too_short", params={"min_length": 8}
            ),
            DjangoValidationError("Too common.", code="password_too_common"),
        ]
    )

    class Password(serializers.Serializer):
        password = serializers.CharField()

        def validate_password(self, value: str) -> str:
            raise django_field_error(rejected)

    assert violations(Password(data={"password": "x"})) == [
        ("password", "TOO_SHORT", {"min_length": 8}),
        ("password", "TOO_COMMON", {}),
    ]


def test_a_reason_raised_by_name_keeps_its_data() -> None:
    class Short(serializers.Serializer):
        password = serializers.CharField()

        def validate_password(self, value: str) -> str:
            raise field_error(FieldReason.TOO_SHORT, min_length=8)

    assert violations(Short(data={"password": "x"})) == [
        ("password", "TOO_SHORT", {"min_length": 8})
    ]


@pytest.mark.django_db
def test_a_refusal_is_one_line_naming_its_route_never_its_path(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The route, not the path: the path is whatever the caller typed."""
    django_request = logging.getLogger("django.request")
    django_request.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.WARNING):
            unmatched = APIClient().get("/api/nothing/<script>")
            known = APIClient().get("/api/conversations")
    finally:
        django_request.removeHandler(caplog.handler)

    assert (unmatched.status_code, refused(unmatched)) == (404, ("NOT_FOUND", {}))
    assert [record.getMessage() for record in caplog.records] == [
        "GET unmatched 404 NOT_FOUND: Not found.",
        "GET api/conversations 401 UNAUTHENTICATED: The request is not signed in.",
    ]
    assert known.status_code == 401


def test_a_path_no_view_has_is_not_found_whatever_the_method_and_whoever_asks() -> None:
    client = APIClient(enforce_csrf_checks=True)

    answers = [client.post("/api/nothing", {}), client.delete("/api/auth/nothing")]

    assert [(each.status_code, refused(each)) for each in answers] == [
        (404, ("NOT_FOUND", {})),
        (404, ("NOT_FOUND", {})),
    ]


def test_a_500_no_view_answered_is_the_coded_body_under_api_only(rf: RequestFactory) -> None:
    api = server_error(rf.get("/api/conversations"))
    page = server_error(rf.get("/c/7"))

    assert (api.status_code, json.loads(api.content)["error"]["code"]) == (500, "INTERNAL")
    assert (page.status_code, page["Content-Type"].split(";")[0]) == (500, "text/html")


def serializer_codes() -> dict[str, set[str]]:
    """Every code a field of an `apps/` serializer may reject with, and where."""
    for module in pkgutil.walk_packages(apps.__path__, "apps."):
        if not {"migrations", "management"} & set(module.name.split(".")):
            importlib.import_module(module.name)

    def subclasses(cls: type) -> Iterator[type]:
        for each in cls.__subclasses__():
            yield each
            yield from subclasses(each)

    codes: dict[str, set[str]] = {}

    def walk(field: object, where: str) -> None:
        if getattr(field, "read_only", False):
            return
        for code in getattr(field, "error_messages", {}):
            codes.setdefault(code, set()).add(where)
        for validator in getattr(field, "validators", []):
            if code := getattr(validator, "code", None):
                codes.setdefault(code, set()).add(where)
        if (child := getattr(field, "child", None)) is not None:
            walk(child, f"{where}.child")
        if isinstance(field, serializers.Serializer):
            for name, each in field.fields.items():
                walk(each, f"{where}.{name}")

    for cls in set(subclasses(serializers.BaseSerializer)):
        if cls.__module__.startswith("apps."):
            walk(cls(), f"{cls.__module__}.{cls.__name__}")
    return codes


def test_every_code_a_serializer_may_reject_with_is_a_reason() -> None:
    """Read from the serializers themselves, so a field added tomorrow is checked too.

    A validator that is a function carries no code of its own (apps/catalog/models.py,
    `validate_book_language`), nor does DRF's `UniqueValidator`; the API tests send
    what each refuses (tests/test_content_api.py, tests/test_accounts_api.py).
    """
    codes = serializer_codes()

    assert codes
    assert {code: sorted(where) for code, where in codes.items() if code not in FIELD_MAP} == {}
