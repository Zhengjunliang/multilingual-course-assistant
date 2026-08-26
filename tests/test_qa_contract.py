"""The SPA's copy of the answer-stream contract must not drift from this one.

`apps/qa/contract.py` is the single source and `frontend/src/api/contract.ts` is
its shadow on the client. Nothing here parses TypeScript: the mirror is read as
text and asked whether every model the Python side declares, and every field
inside it, still appears in the matching declaration. That is enough to catch
the failure that actually happens — a field added or renamed on one side only —
without dragging a TypeScript toolchain into the Python suite, the same trade
`tests/test_smoke.py` makes when it probes for Django with a subprocess.

What it deliberately does not check is the types. A `number` where the server
sends a string is the frontend's own `tsc` problem; this gate exists so that the
names cannot silently disagree.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from apps.qa.contract import (
    Citation,
    EndEvent,
    ErrorEvent,
    StartEvent,
    TokenEvent,
    Unavailable,
)
from rag.agent import RouteDecision

if TYPE_CHECKING:
    from pydantic import BaseModel

MIRROR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api" / "contract.ts"

# Every model that crosses the wire. `RouteDecision` is here because `StartEvent`
# embeds it verbatim rather than copying its fields (apps/qa/contract.py), so the
# client has to know its shape too. `Unavailable` is not an event at all — it is
# the 503 body — but it is the same wire and drifts the same way.
MIRRORED: tuple[type[BaseModel], ...] = (
    RouteDecision,
    Citation,
    StartEvent,
    TokenEvent,
    EndEvent,
    ErrorEvent,
    Unavailable,
)

FIELDS = [(model.__name__, field) for model in MIRRORED for field in model.model_fields]


def declaration(mirror: str, name: str) -> str | None:
    """The body of `name`'s TypeScript declaration, or `None` if it has none.

    Only interfaces have a body worth searching; `EndEvent` is a type alias
    because it carries no fields, and returning `None` for it is correct rather
    than an edge case — there is nothing in it to look for.
    """
    opening = f"export interface {name} {{"
    start = mirror.find(opening)
    if start == -1:
        return None
    end = mirror.find("\n}", start)
    return mirror[start:end] if end != -1 else mirror[start:]


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


@pytest.mark.parametrize("model", MIRRORED, ids=lambda model: model.__name__)
def test_the_mirror_declares_every_model(mirror: str, model: type[BaseModel]) -> None:
    name = model.__name__
    declared = f"export interface {name} " in mirror or f"export type {name} " in mirror
    assert declared, f"{name} is not declared in {MIRROR.name}"


@pytest.mark.parametrize(
    ("model_name", "field"), FIELDS, ids=[f"{model}.{field}" for model, field in FIELDS]
)
def test_the_mirror_declares_every_field(mirror: str, model_name: str, field: str) -> None:
    body = declaration(mirror, model_name)
    assert body is not None, f"{model_name} has fields but no interface in {MIRROR.name}"
    assert f"{field}:" in body, f"{model_name}.{field} is missing from {MIRROR.name}"
