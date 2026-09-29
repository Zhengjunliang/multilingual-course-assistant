"""Switching a course's current edition goes through `set_current()` alone.

The switch is a service function rather than a model method, and these tests
drive it the way its callers do, the admin and the catalogue API: with an
instance loaded earlier, which may no longer match the table by the time it
is used, and, for the API, with a check on the edition it replaces. The concurrency test is the one
test of the suite that runs with `transaction=True` — two threads switch the
same course at once, each on a connection of its own.
"""

from __future__ import annotations

import threading
import time

import pytest
from django.core.exceptions import PermissionDenied
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.catalog.editions import set_current
from apps.catalog.models import Course, CourseEdition

pytestmark = pytest.mark.django_db


@pytest.fixture
def course() -> Course:
    return Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")


def current_editions() -> list[int]:
    return sorted(CourseEdition.objects.filter(is_current=True).values_list("pk", flat=True))


def backend_pid() -> int:
    """The PostgreSQL process behind the calling thread's connection."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_backend_pid()")
        return cursor.fetchone()[0]


def blocking_pids(pid: int) -> list[int]:
    """The processes holding a lock that process `pid` is waiting for."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_blocking_pids(%s)", [pid])
        return cursor.fetchone()[0]


def test_set_current_moves_the_flag_within_its_course_only(course: Course) -> None:
    other_course = Course.objects.create(code="B003725", name="Intelligenza Artificiale")
    CourseEdition.objects.create(course=course, academic_year="2024-2025", is_current=True)
    new = CourseEdition.objects.create(course=course, academic_year="2025-2026")
    elsewhere = CourseEdition.objects.create(
        course=other_course, academic_year="2025-2026", is_current=True
    )

    set_current(new)

    assert current_editions() == sorted([new.pk, elsewhere.pk])
    assert new.is_current


def test_set_current_on_a_deleted_edition_changes_nothing(course: Course) -> None:
    current = CourseEdition.objects.create(
        course=course, academic_year="2024-2025", is_current=True
    )
    gone = CourseEdition.objects.create(course=course, academic_year="2025-2026")
    # Deleted through a queryset, as another request would delete it: the
    # instance's own delete() would also set gone.pk to None.
    CourseEdition.objects.filter(pk=gone.pk).delete()

    with pytest.raises(CourseEdition.DoesNotExist):
        set_current(gone)

    assert current_editions() == [current.pk]
    assert not gone.is_current


@pytest.mark.parametrize(
    ("current_year", "expected"),
    [
        # Another edition is current and the check refuses it: nothing moves,
        # and the check was asked about the row the switch would have cleared.
        pytest.param("2024-2025", ("refused", ["2024-2025"], ["2024-2025"]), id="refused"),
        # No edition to replace, so nothing to ask.
        pytest.param(None, ("switched", ["2025-2026"], []), id="no-current-edition"),
        # The target is already current: nothing is replaced, nothing asked.
        pytest.param("2025-2026", ("switched", ["2025-2026"], []), id="already-current"),
    ],
)
def test_the_replacement_check(
    course: Course, current_year: str | None, expected: tuple[str, list[str], list[str]]
) -> None:
    for year in ("2024-2025", "2025-2026"):
        CourseEdition.objects.create(
            course=course, academic_year=year, is_current=year == current_year
        )
    target = CourseEdition.objects.get(academic_year="2025-2026")
    asked: list[str] = []

    def refuse(replaced: CourseEdition) -> bool:
        asked.append(replaced.academic_year)
        return False

    try:
        set_current(target, may_replace=refuse)
        outcome = "switched"
    except PermissionDenied:
        outcome = "refused"

    current = list(
        CourseEdition.objects.filter(is_current=True).values_list("academic_year", flat=True)
    )
    assert (outcome, current, asked) == expected


@pytest.mark.django_db(transaction=True)
def test_set_current_under_concurrency(course: Course) -> None:
    """Two switches of one course at once leave exactly one current edition.

    The first switch keeps its transaction open until PostgreSQL reports the
    second one waiting on its lock, so the two provably overlap; no sleep
    guesses at it. Every wait has a limit and the lock is released in a
    `finally`, so a broken switch fails the test instead of hanging the suite.
    """
    # Created in autocommit, hence committed: each thread works through a
    # connection of its own, and a connection sees no other's uncommitted rows.
    # That is why this test runs with transaction=True, and why this thread
    # opens no transaction of its own.
    CourseEdition.objects.create(course=course, academic_year="2023-2024", is_current=True)
    first_target = CourseEdition.objects.create(course=course, academic_year="2024-2025")
    second_target = CourseEdition.objects.create(course=course, academic_year="2025-2026")

    locked, second_ready, release = threading.Event(), threading.Event(), threading.Event()
    pids: dict[str, int] = {}
    first_sql: list[str] = []
    errors: list[Exception] = []

    def switch_and_hold() -> None:
        try:
            with CaptureQueriesContext(connection) as queries, transaction.atomic():
                set_current(first_target)
                pids["first"] = backend_pid()
                locked.set()
                # 30 s, not 5: the lock must outlast the main thread's 5 s poll
                # even on a slow machine, or the overlap would go unproved.
                release.wait(30)
            first_sql.extend(query["sql"] for query in queries.captured_queries)
        except Exception as exc:
            errors.append(exc)
        finally:
            connection.close()

    def switch_behind() -> None:
        try:
            pids["second"] = backend_pid()
            second_ready.set()
            set_current(second_target)
        except Exception as exc:
            errors.append(exc)
        finally:
            connection.close()

    first = threading.Thread(target=switch_and_hold)
    second = threading.Thread(target=switch_behind)
    first.start()
    try:
        assert locked.wait(5), "the first switch never took its lock"
        second.start()
        assert second_ready.wait(5), "the second switch never started"
        # pg_blocking_pids reads the lock table as it stands at each call.
        deadline = time.monotonic() + 5
        while pids["first"] not in blocking_pids(pids["second"]):
            assert time.monotonic() < deadline, "the second switch never waited on the first"
            time.sleep(0.01)
    finally:
        release.set()
        for thread in (first, second):
            if thread.ident is not None:  # the second starts only once the first holds its lock
                thread.join(5)

    assert not first.is_alive()
    assert not second.is_alive()
    assert errors == []
    assert current_editions() == [second_target.pk]
    locks = [i for i, sql in enumerate(first_sql) if sql.endswith("FOR UPDATE")]
    writes = [i for i, sql in enumerate(first_sql) if sql.startswith("UPDATE")]
    assert locks, first_sql
    assert writes, first_sql
    assert locks[0] < writes[0], first_sql
