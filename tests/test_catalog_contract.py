"""The SPA's copy of the catalogue API's shapes must not drift from the serializers.

`apps/catalog/serializers.py` and `apps/catalog/content_serializers.py` are the single source and
`frontend/src/api/catalog.ts` its shadow on the client, read as text the way
tests/test_qa_contract.py reads the answer stream's mirror: the fields a
serializer declares and the field names of the interface of the same name are
one set, so neither side can add a field the other lacks. The permission
names, the code sources, the syllabus sections, the importances and the error
codes are compared both ways, since the SPA matches them as strings: a misspelt
permission would hide a button, a misspelt code show the general sentence,
without any type error. The languages a book may be written in are held one
way only, inside Django's table: a Django that adds a language leaves the
form a language short, never offering one the server refuses.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from django.conf import global_settings
from test_qa_contract import declaration, fields

from apps.catalog.content_serializers import (
    ReadingItemSerializer,
    SyllabusSectionSerializer,
    SyllabusSerializer,
)
from apps.catalog.errors import DRF_CODES_SHOWN, StaffError
from apps.catalog.models import CodeSource, Importance, SyllabusSection, TeachingPeriod
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
    "SyllabusSection": SyllabusSectionSerializer,
    "Syllabus": SyllabusSerializer,
    "ReadingItem": ReadingItemSerializer,
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


def test_the_mirror_declares_exactly_the_serializers_fields(mirror: str) -> None:
    declared = {name: fields(declaration(mirror, name)) for name in MIRRORED}

    assert declared == {name: set(serializer().fields) for name, serializer in MIRRORED.items()}


def test_the_mirror_names_every_closed_set(mirror: str) -> None:
    assert (
        union(mirror, "Permission"),
        union(mirror, "CodeSource"),
        union(mirror, "SyllabusSectionKey"),
        union(mirror, "TeachingPeriod"),
        union(mirror, "Importance"),
        union(mirror, "StaffErrorCode"),
    ) == (
        set(Permission),
        set(CodeSource.values),
        set(SyllabusSection.values),
        set(TeachingPeriod.values),
        set(Importance.values),
        set(StaffError) | DRF_CODES_SHOWN,
    )


def test_the_mirror_offers_only_languages_the_server_accepts_for_a_book(mirror: str) -> None:
    start = mirror.index("export const BOOK_LANGUAGES = [")
    offered = re.findall(r'"([^"]*)"', mirror[start : mirror.index("]", start)])

    assert offered
    assert set(offered) <= {code for code, _ in global_settings.LANGUAGES}
