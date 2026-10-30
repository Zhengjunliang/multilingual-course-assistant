"""The SPA's copy of the course list's shapes must not drift from its serializers.

`apps/qa/scope_serializers.py` is the single source and
`frontend/src/api/scope.ts` its shadow on the client, read as text as
tests/test_catalog_contract.py reads the catalogue's: the fields a serializer
declares and the field names of the interface of the same name are one set.
An edition's states are compared both ways, since the composer matches them
as strings.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from test_catalog_contract import union
from test_qa_contract import declaration, fields

from apps.qa.scope import EditionState
from apps.qa.scope_serializers import ScopeCourseSerializer, ScopeEditionSerializer

MIRROR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api" / "scope.ts"

# TypeScript interface -> the serializer it mirrors.
MIRRORED = {"ScopeEdition": ScopeEditionSerializer, "ScopeCourse": ScopeCourseSerializer}


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


def test_the_mirror_declares_exactly_the_serializers_fields(mirror: str) -> None:
    declared = {name: fields(declaration(mirror, name)) for name in MIRRORED}

    assert declared == {name: set(serializer().fields) for name, serializer in MIRRORED.items()}


def test_the_mirror_names_every_edition_state(mirror: str) -> None:
    assert union(mirror, "EditionState") == set(EditionState)
