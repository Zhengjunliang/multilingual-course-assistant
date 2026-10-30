"""Who may call each API route, asked of the running site and compared with tests/access_matrix.txt.

tests/test_route_permissions.py checks that every route declares who may call
it; this file records what the declarations add up to. A row is a method of a
DRF route, as the URL tree resolves them, asked about one fixed object; a
column is a caller of `world()` (tests/test_roles.py), and `anonymous`. A cell
is what the caller got: `deny` (401 for a caller not signed in, 403 for one
who is), `hide` (404), or `allow`, which counts a 400, a 409 or a 415 too: the
request reached the handler, and a body the handler refuses, or one of a type
it does not read, such as the JSON sent to an upload, is not an access refused.
Any other status is a finding of its own.

A change of access, on purpose or not, shows up as a diff of the file. After an
intended one, rewrite the file and review the diff with the change:

    ACCESS_MATRIX_UPDATE=1 uv run pytest tests/test_access_matrix.py

What one object per route cannot show is row-level scope: every logged-in
caller may list programmes, editions and conversations, and which rows each one
gets is tests/test_catalog_api.py's subject and tests/test_qa_api.py's.

Each cell runs in a transaction rolled back after it, with a client of its own:
a logout flushes the session it was sent with, and a revoke logs only on
commit, so nothing one cell does reaches the next.
"""

from __future__ import annotations

import difflib
import os
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from django.core.cache import cache
from django.urls import NoReverseMatch, get_resolver, reverse
from rest_framework.views import APIView
from test_catalog_api import as_user, rolled_back
from test_qa_api import finish
from test_roles import World, everyone, world
from test_route_permissions import DELEGATED, routes, served
from test_sources_api import SHA, stored

from apps.catalog.models import Importance, ReadingItem
from apps.qa import inflight
from apps.qa.contract import QueuedEvent
from apps.qa.models import Conversation, Feedback, Message
from apps.roles.invitations import invite
from apps.roles.registry import Role

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

    from apps.accounts.models import User

pytestmark = pytest.mark.django_db

MATRIX = Path(__file__).with_name("access_matrix.txt")
ANONYMOUS = "anonymous"

type Row = tuple[str, str]  # (route name, method)


def targets(
    w: World, conversation: Conversation, book: ReadingItem, answer: uuid.UUID, rated: Message
) -> dict[str, dict[str, object]]:
    """The object each route with parameters is asked about.

    PPM's current edition, which its teachers and B047's secretariat may act
    on, with one section of its syllabus, a book of its reading list and an
    invitation to teach it; B047, with an invitation to its secretariat; the
    student's account, a conversation of theirs, an answer being written for
    them and one stored and rated; a deck of that edition, ready.
    """
    edition = {"pk": w.ppm_old.pk}
    programme = {"code": w.b047.code}
    account = {"pk": w.student.pk}
    teach, run = (
        invite(w.root, role, scope, None)[0]
        for role, scope in ((Role.TEACHER, w.ppm_old), (Role.SECRETARIAT, w.b047))
    )
    return {
        "catalog:programme": programme,
        "catalog:programme-courses": programme,
        "catalog:programme-secretariat": programme,
        "catalog:programme-secretariat-member": {**programme, "username": w.secretariat.username},
        "catalog:programme-invitations": programme,
        "catalog:programme-invitation": {**programme, "invitation": run.pk},
        "catalog:course": {"code": w.ppm_old.course.code},
        "catalog:edition": edition,
        "catalog:edition-teachers": edition,
        "catalog:edition-teacher": {**edition, "username": w.continuing.username},
        "catalog:edition-invitations": edition,
        "catalog:edition-invitation": {**edition, "invitation": teach.pk},
        "catalog:edition-syllabus": edition,
        "catalog:edition-syllabus-section": {**edition, "section": "prerequisiti"},
        "catalog:edition-readings": edition,
        "catalog:edition-reading": {**edition, "item": book.pk},
        "catalog:edition-materials": edition,
        "manage:user": account,
        "manage:user-activate": account,
        "manage:user-deactivate": account,
        "manage:user-reset-link": account,
        "manage:user-sessions-end": account,
        "qa:conversation": {"pk": conversation.pk},
        "qa:answer-events": {"pk": answer},
        "qa:answer-stop": {"pk": answer},
        "qa:answer-feedback": {"pk": rated.pk},
        "review:feedback-item": {"pk": rated.pk},
        "qa:source": {"sha256": SHA},
    }


def in_flight(answer: uuid.UUID, owner: User) -> None:
    """`answer`, admitted for `owner` and waiting for a worker (apps/qa/inflight.py)."""
    queued = QueuedEvent(answer_id=answer, conversation_id=None, question="Quando?")
    assert inflight.admit(answer, queued, owner=owner.pk, conversation_id=None)


def api_rows() -> list[Row]:
    """Every method of every DRF route, outside the namespaces that answer for themselves.

    OPTIONS is DRF's metadata, not an action; the scoped views refuse it
    outright (`tests/test_route_permissions.py`).
    """
    found: list[Row] = []
    for route in routes(get_resolver().url_patterns):
        view = getattr(route.view, "cls", None)
        if route.namespace.split(":")[0] not in DELEGATED and (
            isinstance(view, type) and issubclass(view, APIView)
        ):
            found += [(route.name, method) for method in sorted(served(view) - {"OPTIONS"})]
    return found


def verdict(status: int) -> str | None:
    if status in (401, 403):
        return "deny"
    if status == 404:
        return "hide"
    if 200 <= status < 300 or status in (400, 409, 415):
        return "allow"
    return None


def render(columns: Sequence[str], matrix: Mapping[Row, Mapping[str, str]]) -> str:
    """The matrix as the file holds it: aligned columns, no trailing space, one final newline."""
    lines = [["route", *columns]]
    lines += [
        [f"{method} {name}", *(matrix[name, method][c] for c in columns)]
        for name, method in sorted(matrix)
    ]
    # The last column is not padded: `trailing-whitespace` would strip it.
    widths = [max(len(line[i]) for line in lines) for i in range(len(columns))]
    padded = (
        " ".join([*(cell.ljust(w) for cell, w in zip(line[:-1], widths, strict=True)), line[-1]])
        for line in lines
    )
    return "\n".join(padded) + "\n"


def drift(recorded: str, observed: str) -> list[str]:
    """The lines that differ, as a unified diff; empty when the two agree."""
    return list(
        difflib.unified_diff(
            recorded.splitlines(), observed.splitlines(), MATRIX.name, "observed", lineterm=""
        )
    )


def status_of(user: User | None, method: str, url: str, ready: Callable[[], None]) -> int:
    def call() -> int:
        cache.clear()  # the throttle would count every cell of a row otherwise
        # And the answers in flight with it, which share the cache's database.
        ready()
        body = "{}" if method in {"POST", "PUT", "PATCH"} else ""
        response = as_user(user).generic(method, url, body, content_type="application/json")
        # A source is a FileResponse, which holds its file open until closed.
        finish(response)
        return response.status_code

    return rolled_back(call)


def test_who_may_call_each_route() -> None:
    w = world()
    stored(w.ppm_old)
    conversation = Conversation.objects.create(owner=w.student, locale="it")
    # A conversation with no messages is missing to its owner too
    # (apps/qa/conversation_views.py, `summaries`).
    asked = Message.objects.create(
        conversation=conversation, role=Message.Role.USER, text="Quando?", locale="it"
    )
    rated = Message.objects.create(
        conversation=conversation,
        parent=asked,
        role=Message.Role.ASSISTANT,
        text="A giugno.",
        locale="it",
        complete=True,
    )
    Feedback.objects.create(answer=rated, rating=Feedback.Rating.UP)
    book = ReadingItem.objects.create(
        edition=w.ppm_old, title="Fondamenti", authors="Rossi", importance=Importance.RECOMMENDED
    )
    answer = uuid.uuid4()
    target = targets(w, conversation, book, answer, rated)
    callers: dict[str, User | None] = {user.username: user for user in everyone(w)}
    callers[ANONYMOUS] = None

    matrix: dict[Row, dict[str, str]] = {}
    odd: dict[tuple[Row, str], int] = {}
    for name, method in api_rows():
        try:
            url = reverse(name, kwargs=target.get(name))
        except NoReverseMatch:
            pytest.fail(f"{name}: give it an object to be asked about in targets()")
        for column, user in callers.items():
            status = status_of(user, method, url, lambda: in_flight(answer, w.student))
            cell = verdict(status)
            if cell is None:
                odd[(name, method), column] = status
            matrix.setdefault((name, method), {})[column] = cell or str(status)

    assert odd == {}
    # The superuser or the owner gets through every route: a row nobody passes
    # is a wrong target or a lost session, not a baseline worth recording.
    assert [row for row, cells in matrix.items() if "allow" not in cells.values()] == []
    assert set(target) <= {name for name, _ in matrix}

    observed = render(list(callers), matrix)
    if os.environ.get("ACCESS_MATRIX_UPDATE") == "1":
        MATRIX.write_text(observed, encoding="utf-8", newline="\n")
    changed = drift(MATRIX.read_text(encoding="utf-8"), observed)
    # The diff as the message: pytest's own rendering of a list cuts it short.
    assert not changed, "\n".join(changed)


RECORDED: dict[Row, dict[str, str]] = {
    ("accounts:me", "GET"): {"student": "allow", ANONYMOUS: "allow"}
}


@pytest.mark.parametrize(
    ("observed", "row", "signs"),
    [
        pytest.param(
            {("accounts:me", "GET"): {"student": "allow", ANONYMOUS: "deny"}},
            "GET accounts:me",
            {"-", "+"},
            id="a-cell-changed",
        ),
        pytest.param(
            {**RECORDED, ("qa:ask", "POST"): {"student": "allow", ANONYMOUS: "allow"}},
            "POST qa:ask",
            {"+"},
            id="a-row-added",
        ),
        pytest.param({}, "GET accounts:me", {"-"}, id="a-row-removed"),
    ],
)
def test_drift_names_the_row_that_changed(
    observed: dict[Row, dict[str, str]], row: str, signs: set[str]
) -> None:
    columns = ["student", ANONYMOUS]

    found = drift(render(columns, RECORDED), render(columns, observed))

    assert {line[0] for line in found if line.startswith(("-", "+")) and row in line} == signs
