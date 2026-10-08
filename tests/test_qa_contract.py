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
names cannot silently disagree. Nullability is the one exception, because `tsc`
cannot see it from the client's side: a field the server may send as `null`
but the mirror types without it compiles cleanly and fails at run time, in the
branch nobody wrote.

The request direction is mirrored too, in `frontend/src/api/client.ts`: the
body's fields against the DRF serializers, and the caps a client stays inside
against the constants the server enforces.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, get_args

import pytest

from apps.qa.contract import (
    Citation,
    EndEvent,
    ErrorEvent,
    StartEvent,
    TokenEvent,
    Unavailable,
)
from apps.qa.models import HISTORY_WINDOW_TURNS
from apps.qa.serializers import (
    MAX_HISTORY_ANSWER_CHARS,
    MAX_QUESTION_CHARS,
    AskRequest,
    TurnSerializer,
)
from rag.agent import RouteDecision

if TYPE_CHECKING:
    from pydantic import BaseModel

API = Path(__file__).resolve().parent.parent / "frontend" / "src" / "api"
MIRROR = API / "contract.ts"
REQUEST_MIRROR = API / "client.ts"

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

NULLABLE = {
    (model.__name__, field)
    for model in MIRRORED
    for field, info in model.model_fields.items()
    if type(None) in get_args(info.annotation)
}


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


def fields(body: str | None) -> set[str]:
    """The field names an interface body declares, one per line; JSDoc lines start with `*`."""
    return set(re.findall(r"^\s+(\w+)\??:", body or "", re.MULTILINE))


@pytest.fixture(scope="module")
def mirror() -> str:
    assert MIRROR.exists(), f"the SPA mirror is missing: {MIRROR}"
    return MIRROR.read_text(encoding="utf-8")


# A model with fields is proven declared by the field test below, which cannot
# find a field without its interface; only a model with none needs asking.
@pytest.mark.parametrize(
    "model", [model for model in MIRRORED if not model.model_fields], ids=lambda m: m.__name__
)
def test_the_mirror_declares_every_model_without_fields(
    mirror: str, model: type[BaseModel]
) -> None:
    name = model.__name__
    declared = f"export interface {name} " in mirror or f"export type {name} " in mirror
    assert declared, f"{name} is not declared in {MIRROR.name}"


@pytest.mark.parametrize(
    ("model_name", "field"), FIELDS, ids=[f"{model}.{field}" for model, field in FIELDS]
)
def test_the_mirror_declares_every_field(mirror: str, model_name: str, field: str) -> None:
    body = declaration(mirror, model_name)
    assert body is not None, f"{model_name} has fields but no interface in {MIRROR.name}"
    line = next((line for line in body.splitlines() if line.strip().startswith(f"{field}:")), None)
    assert line is not None, f"{model_name}.{field} is missing from {MIRROR.name}"
    nullable = (model_name, field) in NULLABLE
    assert ("| null" in line) == nullable, f"{model_name}.{field} nullable is {nullable} in Python"


def test_the_request_mirror_declares_exactly_the_serializers_fields() -> None:
    client = REQUEST_MIRROR.read_text(encoding="utf-8")

    assert fields(declaration(client, "AskBody")) == set(AskRequest().fields)
    assert fields(declaration(client, "HistoryTurn")) == set(TurnSerializer().fields)


def test_the_request_mirror_keeps_the_servers_caps() -> None:
    client = REQUEST_MIRROR.read_text(encoding="utf-8")
    caps = {
        "MAX_QUESTION_CHARS": MAX_QUESTION_CHARS,
        "HISTORY_WINDOW_TURNS": HISTORY_WINDOW_TURNS,
        "MAX_HISTORY_ANSWER_CHARS": MAX_HISTORY_ANSWER_CHARS,
    }

    declared = {
        name: int(value)
        for name, value in re.findall(r"^export const (\w+) = (\d+);$", client, re.MULTILINE)
    }

    assert {name: declared.get(name) for name in caps} == caps
