"""The SPA's copy of the catalogue API's shapes must not drift from the serializers.

`apps/catalog/serializers.py` is the single source and
`frontend/src/api/catalog.ts` its shadow on the client, read as text the way
tests/test_qa_contract.py reads the answer stream's mirror: every field a
serializer declares must appear in the interface of the same name. The
permission names and the error codes are compared both ways, since the SPA
matches them as strings: a misspelt permission would hide a button, a
misspelt code show the general sentence, without any type error.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from test_qa_contract import declaration

from apps.catalog.errors import DRF_CODES_SHOWN, StaffError
from apps.catalog.serializers import (
    CourseSerializer,
    EditionSerializer,
    ProgrammeSerializer,
    StaffMemberSerializer,
)
from apps.roles.registry import Permission

MIRROR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api" / "catalog.ts"

# TypeScript interface -> the serializer it mirrors.
MIRRORED = {
    "Course": CourseSerializer,
    "Programme": ProgrammeSerializer,
    "StaffMember": StaffMemberSerializer,
    "Edition": EditionSerializer,
}


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


def union(mirror: str, name: str) -> set[str]:
    """The string literals of `export type <name> = "a" | "b";`, empty when there is none."""
    start = mirror.find(f"export type {name} =")
    if start == -1:
        return set()
    return set(re.findall(r'"([^"]*)"', mirror[start : mirror.find(";", start)]))


def test_the_mirror_declares_every_field(mirror: str) -> None:
    missing = {
        name: [
            field
            for field in serializer().fields
            if (body := declaration(mirror, name)) is None or f"{field}:" not in body
        ]
        for name, serializer in MIRRORED.items()
    }

    assert {name: fields for name, fields in missing.items() if fields} == {}


def test_the_mirror_names_every_permission_and_error_code(mirror: str) -> None:
    assert (union(mirror, "Permission"), union(mirror, "StaffErrorCode")) == (
        set(Permission),
        set(StaffError) | DRF_CODES_SHOWN,
    )
