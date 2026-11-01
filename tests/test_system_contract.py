"""The SPA's copy of the activity feed's shapes must not drift from apps/system/contract.py.

`frontend/src/api/system.ts` is its shadow, read as text as
tests/test_qa_contract.py reads the answer stream's: every field of every
model, with its nullability, and both closed sets of names, which the page
matches as strings.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, get_args

import pytest
from test_catalog_contract import union
from test_qa_contract import declaration

from apps.materials.models import MaterialStatus
from apps.qa.contract import TERMINAL, StartEvent, StepEvent
from apps.system.contract import (
    ActivityEntry,
    ActivityEvent,
    ActivityKind,
    Refresh,
    Seat,
    Snapshot,
    Worker,
)

if TYPE_CHECKING:
    from pydantic import BaseModel

MIRROR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api" / "system.ts"

MIRRORED: tuple[type[BaseModel], ...] = (ActivityEntry, Worker, Seat, Snapshot, Refresh)

FIELDS = [(model, field) for model in MIRRORED for field in model.model_fields]


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("model", "field"), FIELDS, ids=[f"{model.__name__}.{field}" for model, field in FIELDS]
)
def test_the_mirror_declares_every_field(mirror: str, model: type[BaseModel], field: str) -> None:
    body = declaration(mirror, model.__name__)
    assert body is not None, f"{model.__name__} has no interface in {MIRROR.name}"
    line = next((line for line in body.splitlines() if line.strip().startswith(f"{field}:")), None)
    assert line is not None, f"{model.__name__}.{field} is missing from {MIRROR.name}"
    nullable = type(None) in get_args(model.model_fields[field].annotation)
    assert ("| null" in line) == nullable, f"{model.__name__}.{field} nullable is {nullable}"


def test_the_mirror_names_every_kind_and_event(mirror: str) -> None:
    assert union(mirror, "ActivityKind") == set(get_args(ActivityKind))
    assert union(mirror, "ActivityEvent") == set(get_args(ActivityEvent))


def test_the_events_cover_every_status_of_an_upload_and_every_end_of_an_answer() -> None:
    """The two sources the activity copies: a material's row and the answer stream."""
    events = set(get_args(ActivityEvent))

    assert set(MaterialStatus.values) <= events
    assert {*TERMINAL, StepEvent.NAME, StartEvent.NAME} <= events
