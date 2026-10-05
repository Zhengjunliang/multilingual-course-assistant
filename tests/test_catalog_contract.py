"""The SPA's copy of the catalogue API's shapes must not drift from the serializers.

`apps/catalog/serializers.py` is the single source and
`frontend/src/api/catalog.ts` its shadow on the client, read as text the way
tests/test_qa_contract.py reads the answer stream's mirror: the fields a
serializer declares and the field names of the interface of the same name are
one set, so neither side can add a field the other lacks. The permission
names, the code sources and the error codes are compared both ways, since the
SPA matches them as strings: a misspelt permission would hide a button, a
misspelt code show the general sentence, without any type error.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from test_qa_contract import declaration

from apps.catalog.errors import DRF_CODES_SHOWN, StaffError
from apps.catalog.models import CodeSource
from apps.catalog.serializers import (
    CourseSerializer,
    CurriculumEntrySerializer,
    EditionSerializer,
    EditionSummarySerializer,
    ProgrammeNameSerializer,
    ProgrammeSerializer,
    StaffMemberSerializer,
    StudyPlanCourseSerializer,
)
from apps.roles.registry import Permission

MIRROR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api" / "catalog.ts"

# TypeScript interface -> the serializer it mirrors.
MIRRORED = {
    "Course": CourseSerializer,
    "CurriculumEntry": CurriculumEntrySerializer,
    "ProgrammeName": ProgrammeNameSerializer,
    "Programme": ProgrammeSerializer,
    "StaffMember": StaffMemberSerializer,
    "Edition": EditionSerializer,
    "EditionSummary": EditionSummarySerializer,
    "StudyPlanCourse": StudyPlanCourseSerializer,
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


def fields(body: str | None) -> set[str]:
    """The field names an interface body declares, one per line; JSDoc lines start with `*`."""
    return set(re.findall(r"^\s+(\w+)\??:", body or "", re.MULTILINE))


def test_the_mirror_declares_exactly_the_serializers_fields(mirror: str) -> None:
    declared = {name: fields(declaration(mirror, name)) for name in MIRRORED}

    assert declared == {name: set(serializer().fields) for name, serializer in MIRRORED.items()}


def test_the_mirror_names_every_permission_code_source_and_error_code(mirror: str) -> None:
    assert (
        union(mirror, "Permission"),
        union(mirror, "CodeSource"),
        union(mirror, "StaffErrorCode"),
    ) == (set(Permission), set(CodeSource.values), set(StaffError) | DRF_CODES_SHOWN)
