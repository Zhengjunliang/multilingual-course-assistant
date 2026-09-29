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
from apps.roles.models import RoleAssignment

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


def teachers(edition: CourseEdition) -> str:
    return f"/api/catalog/editions/{edition.pk}/teachers"


def secretariat(code: str) -> str:
    return f"/api/catalog/programmes/{code}/secretariat"


def grant_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "apps.roles.grants"]


def test_granting_and_revoking_staff(
    django_capture_on_commit_callbacks, caplog: pytest.LogCaptureFixture
) -> None:
    w = world()
    before = {str(row) for row in RoleAssignment.objects.all()}

    def attempt(
        user: User, method: str, path: str, body: dict[str, str] | None
    ) -> tuple[int, list[str], list[str], list[str]]:
        caplog.clear()
        # The log line is written on commit; the test's transaction never
        # commits, so the callbacks are run here, before the case is undone.
        with django_capture_on_commit_callbacks(execute=True):
            response = getattr(as_user(user), method)(path, body)
        after = {str(row) for row in RoleAssignment.objects.all()}
        return (
            response.status_code,
            sorted(after - before),
            sorted(before - after),
            grant_lines(caplog),
        )

    new, b047, student = teachers(w.ppm_new), secretariat("B047"), {"username": "student"}
    cases = {
        "secretariat grants a teacher": (w.secretariat, "post", new, student),
        "superuser grants a teacher": (w.root, "post", new, student),
        "superuser grants secretariat staff": (w.root, "post", b047, student),
        "secretariat revokes a teacher": (w.secretariat, "delete", f"{new}/newcomer", None),
        "superuser revokes a teacher": (w.root, "delete", f"{new}/newcomer", None),
        "superuser revokes secretariat staff": (w.root, "delete", f"{b047}/secretariat", None),
    }
    with caplog.at_level("INFO", logger="apps.roles.grants"):
        seen = {case: rolled_back(lambda args=args: attempt(*args)) for case, args in cases.items()}

    teacher_row = "student · teacher · B028451:2025-2026"
    newcomer_row = "newcomer · teacher · B028451:2025-2026"
    assert seen == {
        "secretariat grants a teacher": (
            201,
            [teacher_row],
            [],
            ["granted teacher on B028451:2025-2026 to student by secretariat"],
        ),
        "superuser grants a teacher": (
            201,
            [teacher_row],
            [],
            ["granted teacher on B028451:2025-2026 to student by root"],
        ),
        "superuser grants secretariat staff": (
            201,
            ["student · secretariat · B047"],
            [],
            ["granted secretariat on B047 to student by root"],
        ),
        "secretariat revokes a teacher": (
            204,
            [],
            [newcomer_row],
            ["revoked teacher on B028451:2025-2026 from newcomer by secretariat"],
        ),
        "superuser revokes a teacher": (
            204,
            [],
            [newcomer_row],
            ["revoked teacher on B028451:2025-2026 from newcomer by root"],
        ),
        "superuser revokes secretariat staff": (
            204,
            [],
            ["secretariat · secretariat · B047"],
            ["revoked secretariat on B047 from secretariat by root"],
        ),
    }


def test_staff_requests_that_change_nothing(
    django_capture_on_commit_callbacks, caplog: pytest.LogCaptureFixture
) -> None:
    w = world()
    rows = RoleAssignment.objects.count()
    new, ia, b047 = teachers(w.ppm_new), teachers(w.ia), secretariat("B047")
    student, nobody = {"username": "student"}, {"username": "nobody"}
    requests = {
        # Assigning outside one's scope is a 404, inside it without the
        # assign permission a 403; teachers assign nobody.
        "other programme's secretariat assigns in PPM": (w.other_secretariat, "post", new, student),
        "teacher assigns a teacher": (w.continuing, "post", new, student),
        "teacher assigns on another course": (w.newcomer, "post", ia, student),
        "student assigns": (w.student, "post", new, student),
        "anonymous assigns": (None, "post", new, student),
        # The scope first, then the permission, then the body: an unknown
        # username is told apart only to a caller who may assign here.
        "student names nobody": (w.student, "post", new, nobody),
        "teacher names nobody": (w.continuing, "post", new, nobody),
        "secretariat names nobody": (w.secretariat, "post", new, nobody),
        "secretariat grants what is held": (w.secretariat, "post", new, {"username": "newcomer"}),
        # Only the superuser assigns secretariat staff.
        "secretariat assigns secretariat": (w.secretariat, "post", b047, student),
        "teacher assigns secretariat": (w.continuing, "post", b047, student),
        "other programme's secretariat revokes": (
            w.other_secretariat,
            "delete",
            f"{new}/newcomer",
            None,
        ),
        "teacher revokes": (w.continuing, "delete", f"{new}/newcomer", None),
        "secretariat revokes a non-member": (w.secretariat, "delete", f"{new}/student", None),
        "secretariat revokes their own row": (w.secretariat, "delete", f"{b047}/secretariat", None),
        "teacher lists the teachers": (w.continuing, "get", new, None),
        "secretariat lists the secretariat": (w.secretariat, "get", b047, None),
        "student lists the teachers": (w.student, "get", new, None),
        "GET on a member": (w.secretariat, "get", f"{new}/newcomer", None),
        "DELETE on the collection": (w.secretariat, "delete", new, None),
    }

    seen: dict[str, object] = {}
    with (
        caplog.at_level("INFO", logger="apps.roles.grants"),
        django_capture_on_commit_callbacks(execute=True),
    ):
        for case, (user, method, path, body) in requests.items():
            response = getattr(as_user(user), method)(path, body)
            if response.status_code == 200:
                seen[case] = (200, [member["username"] for member in response.json()])
            elif response.status_code == 400:
                seen[case] = (400, response.json())
            else:
                seen[case] = response.status_code

    assert seen == {
        "other programme's secretariat assigns in PPM": 404,
        "teacher assigns a teacher": 403,
        "teacher assigns on another course": 404,
        "student assigns": 404,
        "anonymous assigns": 403,
        "student names nobody": 404,
        "teacher names nobody": 403,
        "secretariat names nobody": (400, {"username": ["No such user."]}),
        "secretariat grants what is held": (
            400,
            {"username": ["This user already holds this role here."]},
        ),
        "secretariat assigns secretariat": 403,
        "teacher assigns secretariat": 404,
        "other programme's secretariat revokes": 404,
        "teacher revokes": 403,
        "secretariat revokes a non-member": 404,
        "secretariat revokes their own row": 403,
        "teacher lists the teachers": (200, ["continuing", "newcomer"]),
        "secretariat lists the secretariat": (200, ["dual", "inactive", "secretariat"]),
        "student lists the teachers": 404,
        "GET on a member": 405,
        "DELETE on the collection": 405,
    }
    assert RoleAssignment.objects.count() == rows
    assert grant_lines(caplog) == []
