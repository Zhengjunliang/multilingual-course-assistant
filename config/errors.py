"""The closed table of the codes an `/api/` error answers with, and the body it answers in.

A page can translate a code it knows, never a sentence (#186). So an error
names what went wrong with a code from a closed table — `ErrorCode` for the
request as a whole, `FieldReason` for each field a form must correct — and the
page reads the sentence for it from its own catalogue, in the interface's
language. The English `message` beside the code is for the developer and the
log, and no page shows it.

`SPEC` gives each code its HTTP status, so a status is chosen here and nowhere
else, and its message, whose placeholders name the values (`data`) the page's
sentence fills in too. frontend/src/api/errors.ts mirrors both tables, and
tests/test_error_contract.py keeps the mirror equal to them.

The body `error_body` builds::

    {"error": {"code": "INVALID_ARGUMENT", "message": "...", "data": {},
               "fields": [{"field": "password", "reason": "TOO_SHORT",
                           "data": {"min_length": 8}}],
               "request_id": "4bf92f3577b34da6a3ce929d0e0e4736"}}

`request_id` is the request's own (config/request_id.py), so the id a page
shows beside an unexpected error finds the server's lines for that request.

A view refuses with `fail(code)`, or a serializer with `field_error(reason)`;
DRF's and Django's own exceptions are read by their class (`EXCEPTION_MAP`).
`api_exception_handler`, DRF's `EXCEPTION_HANDLER`, answers each of them in
that body and writes one log line for it.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus
from string import Formatter
from typing import TYPE_CHECKING, Any, Literal, NoReturn

from django.core.exceptions import BadRequest, SuspiciousOperation
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from pydantic import BaseModel, ConfigDict
from rest_framework import exceptions
from rest_framework.exceptions import APIException, ErrorDetail, ValidationError
from rest_framework.response import Response
from rest_framework.settings import api_settings

from config.request_id import current

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping, Sequence

# Every refusal is a line here: a WARNING, an ERROR with its traceback for a 5xx.
logger = logging.getLogger(__name__)

# The values a sentence fills in: numbers stay numbers, for the page to format
# in its own language.
ErrorData = dict[str, int | str]


class ErrorCode(StrEnum):
    """What went wrong with a request as a whole; a new member needs a row in `SPEC`.

    Named after `google.rpc.Code` where one fits, and given a code of its own
    only where the reader has something different to do (AIP-193).
    """

    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    MALFORMED_REQUEST = "MALFORMED_REQUEST"
    WRONG_CREDENTIALS = "WRONG_CREDENTIALS"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    CSRF_FAILED = "CSRF_FAILED"
    NOT_FOUND = "NOT_FOUND"
    CONVERSATION_GONE = "CONVERSATION_GONE"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    NOT_ACCEPTABLE = "NOT_ACCEPTABLE"
    UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE"
    ROLE_ALREADY_HELD = "ROLE_ALREADY_HELD"
    SELF_NOT_ALLOWED = "SELF_NOT_ALLOWED"
    ACCOUNT_STILL_ACTIVE = "ACCOUNT_STILL_ACTIVE"
    ROLES_HELD = "ROLES_HELD"
    LAST_SUPERUSER = "LAST_SUPERUSER"
    RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED"
    UNAVAILABLE = "UNAVAILABLE"
    ENGINE_DOWN = "ENGINE_DOWN"
    INTERNAL = "INTERNAL"


class FieldReason(StrEnum):
    """Why one field was rejected; a new member needs a row in `FIELD_SPEC`."""

    REQUIRED = "REQUIRED"
    INVALID = "INVALID"
    TOO_LONG = "TOO_LONG"
    TOO_SHORT = "TOO_SHORT"
    TOO_SMALL = "TOO_SMALL"
    TOO_LARGE = "TOO_LARGE"
    ALREADY_EXISTS = "ALREADY_EXISTS"
    NO_SUCH_USER = "NO_SUCH_USER"
    TOO_COMMON = "TOO_COMMON"
    BREACHED = "BREACHED"
    TOO_SIMILAR = "TOO_SIMILAR"


@dataclass(frozen=True)
class Spec:
    """What a code answers with besides itself.

    `kind` is what the page does with it: a `fixable` error is one the reader
    can act on, and the page gives its sentence alone; a `failure` is one they
    cannot, and the page adds the code and the request id, for a report.
    """

    status: HTTPStatus
    kind: Literal["fixable", "failure"]
    message: str

    @property
    def data_keys(self) -> frozenset[str]:
        """The values the error carries: the message's placeholders, so it states them all."""
        return frozenset(name for _, name, _, _ in Formatter().parse(self.message) if name)


SPEC: dict[ErrorCode, Spec] = {
    # The fields a form must correct are in `fields`.
    ErrorCode.INVALID_ARGUMENT: Spec(
        HTTPStatus.BAD_REQUEST, "fixable", "The request has fields that were rejected."
    ),
    # A body that is not JSON is the client's bug: the reader can only report it.
    ErrorCode.MALFORMED_REQUEST: Spec(
        HTTPStatus.BAD_REQUEST, "failure", "The request could not be read."
    ),
    # Not 401: the page signs the reader out on a 401, and this one is still signing in.
    ErrorCode.WRONG_CREDENTIALS: Spec(
        HTTPStatus.BAD_REQUEST, "fixable", "Wrong username or password."
    ),
    ErrorCode.UNAUTHENTICATED: Spec(
        HTTPStatus.UNAUTHORIZED, "fixable", "The request is not signed in."
    ),
    ErrorCode.PERMISSION_DENIED: Spec(
        HTTPStatus.FORBIDDEN, "fixable", "The signed-in user may not do this."
    ),
    # Apart from PERMISSION_DENIED because the remedy differs: reloading the page.
    ErrorCode.CSRF_FAILED: Spec(HTTPStatus.FORBIDDEN, "failure", "The CSRF check failed."),
    ErrorCode.NOT_FOUND: Spec(HTTPStatus.NOT_FOUND, "fixable", "Not found."),
    # Apart from NOT_FOUND because the chat starts a new conversation on it.
    ErrorCode.CONVERSATION_GONE: Spec(
        HTTPStatus.NOT_FOUND, "fixable", "The conversation does not exist."
    ),
    ErrorCode.METHOD_NOT_ALLOWED: Spec(
        HTTPStatus.METHOD_NOT_ALLOWED, "failure", "The method is not allowed here."
    ),
    ErrorCode.NOT_ACCEPTABLE: Spec(
        HTTPStatus.NOT_ACCEPTABLE, "failure", "No response matches the Accept header."
    ),
    ErrorCode.UNSUPPORTED_MEDIA_TYPE: Spec(
        HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "failure", "The body's media type is not supported."
    ),
    # A conflict with no field to correct; a taken username is a field's (ALREADY_EXISTS).
    ErrorCode.ROLE_ALREADY_HELD: Spec(
        HTTPStatus.CONFLICT, "fixable", "The user holds this role on this scope already."
    ),
    # The rules of apps/accounts/services.py, one code each: what the reader
    # does first differs, from asking for their roles to be revoked to naming
    # another superuser.
    ErrorCode.SELF_NOT_ALLOWED: Spec(
        HTTPStatus.CONFLICT, "fixable", "The account is the caller's own."
    ),
    ErrorCode.ACCOUNT_STILL_ACTIVE: Spec(
        HTTPStatus.CONFLICT, "fixable", "The account is active; it is deactivated first."
    ),
    ErrorCode.ROLES_HELD: Spec(
        HTTPStatus.CONFLICT, "fixable", "The account holds a staff role; it is revoked first."
    ),
    ErrorCode.LAST_SUPERUSER: Spec(
        HTTPStatus.CONFLICT, "fixable", "The account is the last active superuser."
    ),
    ErrorCode.RESOURCE_EXHAUSTED: Spec(
        HTTPStatus.TOO_MANY_REQUESTS,
        "fixable",
        "Too many requests; retry in {retry_after_seconds} seconds.",
    ),
    # Busy with someone else's question: the page retries by itself.
    ErrorCode.UNAVAILABLE: Spec(
        HTTPStatus.SERVICE_UNAVAILABLE,
        "fixable",
        "Another question is being answered; retry in {retry_after_seconds} seconds.",
    ),
    # A service the answer needs is down, and asking again will not start it.
    ErrorCode.ENGINE_DOWN: Spec(
        HTTPStatus.SERVICE_UNAVAILABLE, "failure", "A service the answer needs is not running."
    ),
    ErrorCode.INTERNAL: Spec(
        HTTPStatus.INTERNAL_SERVER_ERROR, "failure", "The server failed to answer."
    ),
}

# The values each reason carries, for the page's sentence.
FIELD_SPEC: dict[FieldReason, frozenset[str]] = {
    FieldReason.REQUIRED: frozenset(),
    FieldReason.INVALID: frozenset(),
    FieldReason.TOO_LONG: frozenset({"max_length"}),
    FieldReason.TOO_SHORT: frozenset({"min_length"}),
    FieldReason.TOO_SMALL: frozenset({"min_value"}),
    FieldReason.TOO_LARGE: frozenset({"max_value"}),
    FieldReason.ALREADY_EXISTS: frozenset(),
    FieldReason.NO_SUCH_USER: frozenset(),
    FieldReason.TOO_COMMON: frozenset(),
    FieldReason.BREACHED: frozenset(),
    FieldReason.TOO_SIMILAR: frozenset(),
}

# A missing row would surface as a KeyError in the middle of answering an
# error; this way the server does not start.
if missing := (set(ErrorCode) - SPEC.keys()) | (set(FieldReason) - FIELD_SPEC.keys()):
    raise RuntimeError(f"config/errors.py: no row for {sorted(missing)}")

# The codes DRF's fields and Django's validators reject a field with, each
# read as the reason a page has a sentence for.
FIELD_MAP: dict[str, FieldReason] = {
    "required": FieldReason.REQUIRED,
    "blank": FieldReason.REQUIRED,
    "null": FieldReason.REQUIRED,
    "empty": FieldReason.REQUIRED,
    "invalid": FieldReason.INVALID,
    "not_a_list": FieldReason.INVALID,
    "invalid_choice": FieldReason.INVALID,
    "max_string_length": FieldReason.INVALID,
    "null_characters_not_allowed": FieldReason.INVALID,
    "surrogate_characters_not_allowed": FieldReason.INVALID,
    "max_length": FieldReason.TOO_LONG,
    "min_length": FieldReason.TOO_SHORT,
    "min_value": FieldReason.TOO_SMALL,
    "max_value": FieldReason.TOO_LARGE,
    "unique": FieldReason.ALREADY_EXISTS,
    "password_too_short": FieldReason.TOO_SHORT,
    "password_too_long": FieldReason.TOO_LONG,
    "password_too_common": FieldReason.TOO_COMMON,
    "password_compromised": FieldReason.BREACHED,
    "password_too_similar": FieldReason.TOO_SIMILAR,
}


class FieldViolation(BaseModel):
    """One rejected field: its path, dots between names and indexes (`items.0.title`).

    `field` is `None` for an error of the object as a whole.
    """

    model_config = ConfigDict(frozen=True)

    field: str | None
    reason: FieldReason
    data: ErrorData


class ErrorBody(BaseModel):
    """What `"error"` holds in every error body."""

    model_config = ConfigDict(frozen=True)

    code: ErrorCode
    message: str
    data: ErrorData
    fields: list[FieldViolation]
    request_id: str


def error_body(
    code: ErrorCode,
    data: Mapping[str, int | str] | None = None,
    fields: Sequence[FieldViolation] = (),
) -> dict[str, Any]:
    """The body that answers `code`, under the id of the request being answered."""
    data = dict(data or {})
    body = ErrorBody(
        code=code,
        message=SPEC[code].message.format(**data),
        data=data,
        fields=list(fields),
        request_id=current(),
    )
    return {"error": body.model_dump(mode="json")}


def _check_member(member: StrEnum, table: type[StrEnum]) -> None:
    # A bare string is a str too, and finds its member's row by hash, so only
    # the exact type tells a code from a sentence or a misspelling.
    if type(member) is not table:
        raise TypeError(f"a member of {table.__name__}, not {member!r}")


def _check_data(member: StrEnum, data: Mapping[str, object], keys: Collection[str]) -> None:
    if data.keys() != set(keys):
        raise TypeError(f"{member} carries {sorted(keys)}, not {sorted(data)}")


class ApiFailure(APIException):
    """An error of the request as a whole, with its code; `fail` raises it."""

    def __init__(self, code: ErrorCode, data: Mapping[str, int | str]) -> None:
        _check_member(code, ErrorCode)
        spec = SPEC[code]
        _check_data(code, data, spec.data_keys)
        super().__init__(spec.message.format(**data), code)
        self.status_code = spec.status
        self.code = code
        self.data: ErrorData = dict(data)


def fail(code: ErrorCode, **data: int | str) -> NoReturn:
    """Refuse the request with `code`, carrying the values its sentence fills in."""
    raise ApiFailure(code, data)


# A field's reason and its data travel inside the code of DRF's `ErrorDetail`,
# `TOO_SHORT|{"min_length":8}`: a serializer keeps only the text and the code
# of each error it collects (`_get_error_details` builds a new `ErrorDetail`
# from the two), so anything else attached to the error would be lost.
_DATA_SEPARATOR = "|"


def encode_field_code(reason: FieldReason, data: Mapping[str, int | str]) -> str:
    if not data:
        return str(reason)
    return f"{reason}{_DATA_SEPARATOR}{json.dumps(data, sort_keys=True, separators=(',', ':'))}"


def decode_field_code(code: str) -> tuple[str, ErrorData]:
    """The code and the data `encode_field_code` put together; DRF's own codes carry no data."""
    name, separator, data = code.partition(_DATA_SEPARATOR)
    return name, json.loads(data) if separator else {}


def field_error(
    reason: FieldReason, *, field: str | None = None, **data: int | str
) -> ValidationError:
    """A field's rejection, for a serializer to raise.

    Without `field` it is for `validate_<field>`, which files it under the field
    it validates; `validate()` names the field, or leaves it out for an error
    of the object as a whole.
    """
    _check_member(reason, FieldReason)
    _check_data(reason, data, FIELD_SPEC[reason])
    detail = [ErrorDetail(str(reason), code=encode_field_code(reason, data))]
    return ValidationError(detail if field is None else {field: detail})


def django_field_error(exc: DjangoValidationError, *, field: str | None = None) -> ValidationError:
    """Django's rejections of one value: each by its code and parameters.

    Django's validators say why by `code` and the values their message names by
    `params` (`password_too_short` with `min_length`), which is what a reason
    and its data are; a code no row names reads as `INVALID` in the handler.
    `field` as in `field_error`: left out in `validate_<field>`, named in
    `validate()`.
    """
    details = []
    for error in exc.error_list:
        reason = FIELD_MAP.get(error.code or "")
        params = error.params or {}
        if reason is None:
            details.append(ErrorDetail(str(FieldReason.INVALID), code=error.code or "invalid"))
            continue
        data = {key: params[key] for key in FIELD_SPEC[reason] if key in params}
        details.append(ErrorDetail(str(reason), code=encode_field_code(reason, data)))
    return ValidationError(details if field is None else {field: details})


# What every `/api/` error is read as, by its class; the first row that
# matches wins, so a subclass comes before its base. Django's `Http404` and
# `PermissionDenied` are here as they are, rather than turned into DRF's first.
# Django reads a body it will not parse, past `DATA_UPLOAD_MAX_NUMBER_FIELDS`
# or `DATA_UPLOAD_MAX_MEMORY_SIZE`, as a `SuspiciousOperation`, which it would
# answer with a 400 itself.
EXCEPTION_MAP: tuple[tuple[type[Exception], ErrorCode], ...] = (
    (exceptions.ParseError, ErrorCode.MALFORMED_REQUEST),
    (SuspiciousOperation, ErrorCode.MALFORMED_REQUEST),
    (BadRequest, ErrorCode.MALFORMED_REQUEST),
    (exceptions.ValidationError, ErrorCode.INVALID_ARGUMENT),
    (exceptions.NotAuthenticated, ErrorCode.UNAUTHENTICATED),
    (exceptions.AuthenticationFailed, ErrorCode.UNAUTHENTICATED),
    (exceptions.PermissionDenied, ErrorCode.PERMISSION_DENIED),
    (DjangoPermissionDenied, ErrorCode.PERMISSION_DENIED),
    (exceptions.NotFound, ErrorCode.NOT_FOUND),
    (Http404, ErrorCode.NOT_FOUND),
    (exceptions.MethodNotAllowed, ErrorCode.METHOD_NOT_ALLOWED),
    (exceptions.NotAcceptable, ErrorCode.NOT_ACCEPTABLE),
    (exceptions.UnsupportedMediaType, ErrorCode.UNSUPPORTED_MEDIA_TYPE),
    (exceptions.Throttled, ErrorCode.RESOURCE_EXHAUSTED),
)

# A throttle that cannot say how long to wait: every rate is per minute
# (config/settings.py, `DEFAULT_THROTTLE_RATES`), so a minute is its window.
THROTTLE_WINDOW_SECONDS = 60

# The challenge a 401 carries (RFC 9110, 11.6.1). The credential is the session
# cookie, which no browser prompts for, unlike `Basic`.
CHALLENGE = 'Session realm="api"'

# The name of the pattern that catches every `/api/` path no view has
# (config/urls.py), logged as "unmatched" rather than as whatever was asked for.
UNMATCHED = "api-unmatched"

# The field attribute each reason's value is read from, when DRF's own code
# carried none.
_FIELD_ATTRIBUTE = {
    FieldReason.TOO_LONG: "max_length",
    FieldReason.TOO_SHORT: "min_length",
    FieldReason.TOO_SMALL: "min_value",
    FieldReason.TOO_LARGE: "max_value",
}


def _code_of(exc: Exception) -> ErrorCode:
    if isinstance(exc, ApiFailure):
        return exc.code
    return next((code for kind, code in EXCEPTION_MAP if isinstance(exc, kind)), ErrorCode.INTERNAL)


def _data_of(exc: Exception, code: ErrorCode) -> ErrorData:
    if isinstance(exc, ApiFailure):
        return exc.data
    if code is ErrorCode.RESOURCE_EXHAUSTED:
        wait = getattr(exc, "wait", None)
        return {"retry_after_seconds": THROTTLE_WINDOW_SECONDS if wait is None else math.ceil(wait)}
    return {}


def _field_at(serializer: object, path: str) -> object:
    """The serializer field `path` names, through nested serializers and lists, if any does."""
    field = serializer
    for name in path.split("."):
        field = getattr(field, "child", field)
        if name.isdigit():
            continue
        fields = getattr(field, "fields", None)
        field = fields.get(name) if fields is not None else None
        if field is None:
            return None
    return field


def _violation(leaf: object, path: str | None, serializer: object) -> FieldViolation:
    """One rejected field, read from DRF's error; a code no row names reads as `INVALID`."""
    name, data = decode_field_code(getattr(leaf, "code", None) or "invalid")
    reason = FIELD_MAP.get(name) or (FieldReason(name) if name in FieldReason else None)
    if reason is not None and not data and reason in _FIELD_ATTRIBUTE and path is not None:
        value = getattr(_field_at(serializer, path), _FIELD_ATTRIBUTE[reason], None)
        if value is not None:
            data = {_FIELD_ATTRIBUTE[reason]: value if isinstance(value, int) else str(value)}
    if reason is None or data.keys() != FIELD_SPEC[reason]:
        logger.warning("field %s: %r with %s read as INVALID", path, name, sorted(data))
        return FieldViolation(field=path, reason=FieldReason.INVALID, data={})
    return FieldViolation(field=path, reason=reason, data=data)


def _violations(detail: object, path: str | None, serializer: object) -> list[FieldViolation]:
    """Every rejected field under `detail`, by dotted path; `non_field_errors` is the object's."""
    if isinstance(detail, dict):
        found: list[FieldViolation] = []
        for key, value in detail.items():
            name = None if key == api_settings.NON_FIELD_ERRORS_KEY else str(key)
            joined = path if name is None else name if path is None else f"{path}.{name}"
            found += _violations(value, joined, serializer)
        return found
    if isinstance(detail, list):
        found = []
        for index, item in enumerate(detail):
            nested = isinstance(item, dict | list)
            where = (str(index) if path is None else f"{path}.{index}") if nested else path
            found += _violations(item, where, serializer)
        return found
    return [_violation(detail, path, serializer)]


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    """Every error of an `/api/` view, answered with one coded body (`EXCEPTION_HANDLER`).

    The status is the code's, and the message its template: what the
    exception says is never read, so no sentence of DRF's, Django's or this
    project's reaches the body. An exception nothing names is `INTERNAL`, a
    500, in development too: the traceback is in the log line.
    """
    code = _code_of(exc)
    data = _data_of(exc, code)
    fields: list[FieldViolation] = []
    if isinstance(exc, exceptions.ValidationError):
        fields = _violations(exc.detail, None, getattr(exc.detail, "serializer", None))
    status = SPEC[code].status
    headers: dict[str, str] = {}
    if code is ErrorCode.UNAUTHENTICATED:
        headers["WWW-Authenticate"] = CHALLENGE
    if "retry_after_seconds" in data:
        headers["Retry-After"] = str(data["retry_after_seconds"])

    body = error_body(code, data, fields)
    request = context.get("request")
    match = getattr(request, "resolver_match", None)
    route = "unmatched" if match is None or match.url_name == UNMATCHED else match.route
    line = (getattr(request, "method", "-"), route, int(status), code, body["error"]["message"])
    if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
        logger.error("%s %s %s %s: %s", *line, exc_info=exc)
    else:
        logger.warning("%s %s %s %s: %s", *line)

    # Imported here: `rest_framework.views` reads `DEFAULT_AUTHENTICATION_CLASSES`
    # as it loads, and the session authentication there refuses through this module.
    from rest_framework.views import set_rollback

    set_rollback()
    response = Response(body, status=status, headers=headers)
    # Logged above, with the code: Django's own line would repeat it, with the raw path.
    response._has_been_logged = True  # pyright: ignore[reportAttributeAccessIssue]
    return response
