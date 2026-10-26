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
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus
from string import Formatter
from typing import TYPE_CHECKING, Any, Literal, NoReturn

from pydantic import BaseModel, ConfigDict
from rest_framework.exceptions import APIException, ErrorDetail, ValidationError

from config.request_id import current

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping, Sequence

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
    ENTIRELY_NUMERIC = "ENTIRELY_NUMERIC"
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
        HTTPStatus.BAD_REQUEST, "failure", "The request body could not be parsed."
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
    FieldReason.ENTIRELY_NUMERIC: frozenset(),
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
    "invalid": FieldReason.INVALID,
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
    "password_too_common": FieldReason.TOO_COMMON,
    "password_entirely_numeric": FieldReason.ENTIRELY_NUMERIC,
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
