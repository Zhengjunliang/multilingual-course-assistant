"""The catalogue API, asked by each kind of caller in `world()` (tests/test_roles.py).

What each caller gets is gathered into one mapping and compared whole, so a
failure shows exactly which caller got what. A case that writes runs inside a
transaction rolled back after it, so every case starts from the same world
without building it again. Every caller logs in through `force_login`,
which costs no password hash; the session, and with it the CSRF check a
logged-in write goes through, is real.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from test_roles import everyone, label, world

from apps.catalog.editions import SWITCH_NEEDS_BOTH
from apps.catalog.models import CourseEdition

if TYPE_CHECKING:
    from collections.abc import Callable

    from apps.accounts.models import User

pytestmark = pytest.mark.django_db

EDITIONS_URL = "/api/catalog/editions"
PROGRAMMES_URL = "/api/catalog/programmes"
OLD, NEW = "B028451:2024-2025", "B028451:2025-2026"  # PPM's editions; the old one is current

TEACHES = ["edition.set_current", "edition.view"]
RUNS_EDITION = ["edition.assign_teacher", "edition.set_current", "edition.view"]


def as_user(user: User | None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_login(user)
    return client


def switch_url(edition: CourseEdition) -> str:
    return f"/api/catalog/editions/{edition.pk}/set-current"


def test_each_caller_lists_their_own_scope() -> None:
    w = world()

    seen: dict[str, object] = {}
    for user in (*everyone(w), None):
        client = as_user(user)
        editions, programmes = client.get(EDITIONS_URL), client.get(PROGRAMMES_URL)
        name = user.username if user is not None else "anonymous"
        if editions.status_code != 200:
            seen[name] = (editions.status_code, programmes.status_code)
            continue
        seen[name] = (
            {
                f"{e['course']['code']}:{e['academic_year']}": e["permissions"]
                for e in editions.json()
            },
            {p["code"]: p["permissions"] for p in programmes.json()},
        )

    ppm_old, ppm_new, ia, shared = OLD, NEW, "B003725:2025-2026", "B000001:2025-2026"
    assert seen == {
        "continuing": ({ppm_old: TEACHES, ppm_new: TEACHES}, {}),
        "newcomer": ({ppm_new: TEACHES}, {}),
        "secretariat": (
            {ppm_old: RUNS_EDITION, ppm_new: RUNS_EDITION, shared: RUNS_EDITION},
            {"B047": ["programme.view"]},
        ),
        "other_secretariat": (
            {ia: RUNS_EDITION, shared: RUNS_EDITION},
            {"L031": ["programme.view"]},
        ),
        "dual": (
            {ia: TEACHES, ppm_old: RUNS_EDITION, ppm_new: RUNS_EDITION, shared: RUNS_EDITION},
            {"B047": ["programme.view"]},
        ),
        "student": ({}, {}),
        "root": (
            {ppm_old: RUNS_EDITION, ppm_new: RUNS_EDITION, ia: RUNS_EDITION, shared: RUNS_EDITION},
            {
                "B047": ["programme.assign_secretariat", "programme.view"],
                "L031": ["programme.assign_secretariat", "programme.view"],
            },
        ),
        # A disabled account has no session, whatever it held.
        "inactive": (403, 403),
        "anonymous": (403, 403),
    }


def rolled_back[T](call: Callable[[], T]) -> T:
    """What `call` returns, with every row it wrote undone, so the next case starts afresh."""
    with transaction.atomic():
        result = call()
        transaction.set_rollback(True)
    return result


def test_switching_the_current_edition() -> None:
    w = world()

    def switch(user: User | None, method: str) -> tuple[int, str, str | None]:
        response = getattr(as_user(user), method)(switch_url(w.ppm_new))
        body = response.json()
        if body.get("id") == w.ppm_new.pk and body.get("is_current") is True:
            said = "the edition, now current"
        elif body.get("detail") == SWITCH_NEEDS_BOTH:
            said = "needs both"
        else:
            said = None
        current = CourseEdition.objects.get(course__code="B028451", is_current=True)
        return response.status_code, label(current), said

    cases = {
        "teacher of both years": (w.continuing, "post"),
        "first-year teacher": (w.newcomer, "post"),
        "secretariat": (w.secretariat, "post"),
        "other programme's secretariat": (w.other_secretariat, "post"),
        "student": (w.student, "post"),
        "anonymous": (None, "post"),
        "GET": (w.continuing, "get"),
    }
    seen = {
        case: rolled_back(lambda user=user, method=method: switch(user, method))
        for case, (user, method) in cases.items()
    }

    assert seen == {
        # The teacher of both years may replace last year's edition.
        "teacher of both years": (200, NEW, "the edition, now current"),
        # A first-year teacher may not replace last year's edition, and the
        # refusal says so: the secretariat switches it for them.
        "first-year teacher": (403, OLD, "needs both"),
        "secretariat": (200, NEW, "the edition, now current"),
        "other programme's secretariat": (404, OLD, None),
        "student": (404, OLD, None),
        "anonymous": (403, OLD, None),
        "GET": (405, OLD, None),
    }


def test_a_write_without_the_csrf_token_is_refused() -> None:
    w = world()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(w.continuing)

    response = client.post(switch_url(w.ppm_new))

    assert response.status_code == 403
    assert CourseEdition.objects.get(pk=w.ppm_old.pk).is_current


def test_the_edition_list_costs_the_same_for_more_editions() -> None:
    w = world()
    client = as_user(w.secretariat)

    def queries() -> tuple[int, int]:
        with CaptureQueriesContext(connection) as captured:
            listed = len(client.get(EDITIONS_URL).json())
        return listed, len(captured.captured_queries)

    few = queries()
    for year in ("2022-2023", "2023-2024"):
        CourseEdition.objects.create(course=w.ppm_old.course, academic_year=year)
    more = queries()

    assert (few[0], more[0]) == (3, 5)
    assert few[1] == more[1]
