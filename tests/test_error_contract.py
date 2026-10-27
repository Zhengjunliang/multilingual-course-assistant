"""The error codes: one table on the server, its mirror on the client, and the body they answer in.

`config/errors.py` is the single source and `frontend/src/api/errors.ts` its
shadow, read as text the way tests/test_qa_contract.py reads the answer
stream's: each code's status, kind and data, each field reason's data, and the
body's field names are compared both ways, since the page picks a sentence by
the code's string and fills it from `data` by name, neither of which a type
error would catch. docs/api.md's two tables, which a client's developer reads,
are held to the same rows. And each code and reason is used somewhere in
`apps/` or `config/`, read off their syntax trees.

No `django_db` marker: building an error reaches no database.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, get_args

import pytest
from django.http import JsonResponse
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail, ValidationError
from test_qa_contract import declaration, fields

from config.errors import (
    FIELD_SPEC,
    SPEC,
    ApiFailure,
    ErrorBody,
    ErrorCode,
    FieldReason,
    FieldViolation,
    decode_field_code,
    error_body,
    fail,
    field_error,
)
from config.request_id import RequestIdMiddleware

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponseBase
    from django.test import RequestFactory
    from pydantic import BaseModel

    from config.errors import ErrorData

ROOT = Path(__file__).resolve().parent.parent
MIRROR = ROOT / "frontend" / "src" / "api" / "errors.ts"

# `NAME: { status: 400, kind: "fixable", dataKeys: [] }`, on one line or wrapped.
CODE_ROW = re.compile(r'(\w+): \{\s*status: (\d+),\s*kind: "(\w+)",\s*dataKeys: \[([^\]]*)\]')
REASON_ROW = re.compile(r"(\w+): \{\s*dataKeys: \[([^\]]*)\]")


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


def table(mirror: str, name: str) -> str:
    start = mirror.index(f"export const {name} = {{")
    return mirror[start : mirror.index("} as const", start)]


def keys(array: str) -> frozenset[str]:
    return frozenset(re.findall(r'"(\w+)"', array))


def refused(response: HttpResponseBase) -> tuple[str, dict[str | None, list[str]]]:
    """A refusal as a page reads it: its code, and the reasons of each field it rejected.

    The other API tests read their refusals through this, so none of them leans
    on the body's layout or on its English message.
    """
    error = response.json()["error"]  # pyright: ignore[reportAttributeAccessIssue]
    fields: dict[str | None, list[str]] = {}
    for violation in error["fields"]:
        fields.setdefault(violation["field"], []).append(violation["reason"])
    return error["code"], fields


def test_the_mirror_holds_every_code_with_its_status_kind_and_data(mirror: str) -> None:
    rows = {
        code: (int(status), kind, keys(data))
        for code, status, kind, data in CODE_ROW.findall(table(mirror, "ERROR_CODES"))
    }

    assert rows == {code: (spec.status, spec.kind, spec.data_keys) for code, spec in SPEC.items()}


def test_the_mirror_holds_every_field_reason_with_its_data(mirror: str) -> None:
    rows = {
        reason: keys(data) for reason, data in REASON_ROW.findall(table(mirror, "FIELD_REASONS"))
    }

    assert rows == FIELD_SPEC


API_DOCUMENT = ROOT / "docs" / "api.md"

# A row of the document's two tables: `| `CODE` | 400 | fixable | means | `key` |`
# and `| `REASON` | means | `key` |`, the data cell empty when there is none.
DOCUMENTED_CODE = re.compile(
    r"^\| `(\w+)` \| (\d{3}) \| (\w+) \| [^|\n]* \|([^|\n]*)\|$", re.MULTILINE
)
DOCUMENTED_REASON = re.compile(r"^\| `(\w+)` \| [^|\n]* \|([^|\n]*)\|$", re.MULTILINE)


@pytest.fixture(scope="module")
def documented() -> str:
    """The section of docs/api.md a client's developer reads the codes in."""
    text = API_DOCUMENT.read_text(encoding="utf-8")
    start = text.index("\n## Errors\n")
    end = text.find("\n## ", start + 1)
    return text[start : None if end == -1 else end]


def documented_keys(cell: str) -> frozenset[str]:
    return frozenset(re.findall(r"`(\w+)`", cell))


def test_the_api_document_lists_every_code_with_its_status_kind_and_data(documented: str) -> None:
    rows = {
        code: (int(status), kind, documented_keys(data))
        for code, status, kind, data in DOCUMENTED_CODE.findall(documented)
    }

    assert rows == {code: (spec.status, spec.kind, spec.data_keys) for code, spec in SPEC.items()}


def test_the_api_document_lists_every_field_reason_with_its_data(documented: str) -> None:
    rows = {reason: documented_keys(data) for reason, data in DOCUMENTED_REASON.findall(documented)}

    assert rows == FIELD_SPEC


def shape(model: type[BaseModel]) -> tuple[set[str], set[str]]:
    """The model's field names, and those of them that may be `None`."""
    nullable = {
        name for name, info in model.model_fields.items() if type(None) in get_args(info.annotation)
    }
    return set(model.model_fields), nullable


def declared_shape(mirror: str, name: str) -> tuple[set[str], set[str]]:
    body = declaration(mirror, name)
    return fields(body), set(re.findall(r"^\s+(\w+)\??: [^;\n]*\| null", body or "", re.MULTILINE))


def test_the_mirror_declares_exactly_the_bodys_fields(mirror: str) -> None:
    models = (ErrorBody, FieldViolation)

    assert {model.__name__: declared_shape(mirror, model.__name__) for model in models} == {
        model.__name__: shape(model) for model in models
    }


TABLES = (ErrorCode, FieldReason)
EVERY_MEMBER = {f"{table.__name__}.{member.name}" for table in TABLES for member in table}
# The tables that define the members, which naming one there does not use.
DEFINING = {"SPEC", "FIELD_SPEC"}


def named(source: str) -> set[str]:
    """The members a module names, `ErrorCode.NOT_FOUND`, outside `DEFINING`."""
    found: set[str] = set()
    for statement in ast.parse(source).body:
        if isinstance(statement, ast.Assign):
            targets = statement.targets
        elif isinstance(statement, ast.AnnAssign):
            targets = [statement.target]
        else:
            targets = []
        if any(isinstance(target, ast.Name) and target.id in DEFINING for target in targets):
            continue
        found |= {
            f"{node.value.id}.{node.attr}"
            for node in ast.walk(statement)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in {table.__name__ for table in TABLES}
        }
    return found


@pytest.fixture(scope="module")
def uses() -> dict[Path, set[str]]:
    sources = {
        path: path.read_text(encoding="utf-8")
        for package in ("apps", "config")
        for path in (ROOT / package).rglob("*.py")
    }
    # Only a module that spells a table's name can name a member of it, and
    # parsing the rest, migrations above all, is most of the time.
    return {
        path: named(source)
        for path, source in sources.items()
        if any(table.__name__ in source for table in TABLES)
    }


def test_every_code_and_reason_is_raised_mapped_or_read(uses: dict[Path, set[str]]) -> None:
    """One nothing uses is an error that cannot happen, with a sentence in three
    catalogues for it: deleted, not kept."""
    assert EVERY_MEMBER - set().union(*uses.values()) == set()


def test_a_code_that_loses_its_only_use_is_reported(uses: dict[Path, set[str]]) -> None:
    """The check above, against a tree whose one CSRF refusal became another code."""
    [only] = [path for path, found in uses.items() if "ErrorCode.CSRF_FAILED" in found]
    source = only.read_text(encoding="utf-8")
    lost = named(source.replace("ErrorCode.CSRF_FAILED", "ErrorCode.PERMISSION_DENIED"))

    used = set().union(*(found for path, found in uses.items() if path != only), lost)

    assert EVERY_MEMBER - used == {"ErrorCode.CSRF_FAILED"}


class Probe(serializers.Serializer):
    """Rejects as the API's serializers do: in a field's validator, in `validate()`, in DRF's."""

    password = serializers.CharField()
    title = serializers.CharField(max_length=3)

    def validate_password(self, value: str) -> str:
        if value == "short":
            raise field_error(FieldReason.TOO_SHORT, min_length=8)
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        raise field_error(FieldReason.ALREADY_EXISTS, field="title")


def rejected(data: dict[str, str]) -> dict[str, list[tuple[str, ErrorData]]]:
    """Each rejected field's codes, decoded, as `is_valid` raises them."""
    with pytest.raises(ValidationError) as caught:
        Probe(data=data).is_valid(raise_exception=True)
    detail = caught.value.detail
    assert isinstance(detail, dict)
    return {
        name: [
            decode_field_code(str(error.code)) for error in errors if isinstance(error, ErrorDetail)
        ]
        for name, errors in detail.items()
        if isinstance(errors, list)
    }


def test_a_reason_keeps_its_data_through_a_serializer() -> None:
    assert rejected({"password": "short", "title": "long"}) == {
        "password": [("TOO_SHORT", {"min_length": 8})],
        "title": [("max_length", {})],
    }
    assert rejected({"password": "long enough", "title": "abc"}) == {
        "title": [("ALREADY_EXISTS", {})]
    }


def test_fail_refuses_with_the_codes_status_and_message() -> None:
    with pytest.raises(ApiFailure) as caught:
        fail(ErrorCode.RESOURCE_EXHAUSTED, retry_after_seconds=30)

    failure = caught.value
    assert (failure.status_code, failure.code, failure.data) == (
        429,
        ErrorCode.RESOURCE_EXHAUSTED,
        {"retry_after_seconds": 30},
    )
    assert failure.detail == "Too many requests; retry in 30 seconds."


@pytest.mark.parametrize(
    "refusal",
    [
        lambda: fail("NOT_FOUND"),  # pyright: ignore[reportArgumentType]
        lambda: fail(ErrorCode.RESOURCE_EXHAUSTED),
        lambda: fail(ErrorCode.NOT_FOUND, username="mario"),
        lambda: field_error("REQUIRED"),  # pyright: ignore[reportArgumentType]
        lambda: field_error(FieldReason.TOO_SHORT),
    ],
    ids=["bare code", "data missing", "data extra", "bare reason", "reason data missing"],
)
def test_only_a_member_of_the_table_with_its_data_is_raised(refusal: Callable[[], object]) -> None:
    with pytest.raises(TypeError):
        refusal()


def test_the_body_names_the_request_it_answers(rf: RequestFactory) -> None:
    violation = FieldViolation(
        field="password", reason=FieldReason.TOO_SHORT, data={"min_length": 8}
    )

    def view(request: HttpRequest) -> JsonResponse:
        return JsonResponse(error_body(ErrorCode.INVALID_ARGUMENT, fields=[violation]))

    response = RequestIdMiddleware(view)(rf.get("/"))

    assert isinstance(response, JsonResponse)
    assert json.loads(response.content) == {
        "error": {
            "code": "INVALID_ARGUMENT",
            "message": "The request has fields that were rejected.",
            "data": {},
            "fields": [{"field": "password", "reason": "TOO_SHORT", "data": {"min_length": 8}}],
            "request_id": response["X-Request-ID"],
        }
    }
