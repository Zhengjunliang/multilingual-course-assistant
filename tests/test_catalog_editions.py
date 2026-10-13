"""A course's current edition is the newest one whose teaching has started.

`with_current()` is asked about one day, given to it, so each case names its
own day and nothing depends on when the suite runs. The cases are the rule's
edges: the day before a start and the start itself, two started editions, an
edition with no start day, which counts from 1 September of its first year,
and a course none of whose editions has started. A last test pins that the
mark costs no query of its own and ignores which editions the queryset holds.
"""

from __future__ import annotations

from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.catalog.editions import IS_CURRENT, with_current
from apps.catalog.models import Course, CourseEdition

pytestmark = pytest.mark.django_db

SEPTEMBER = date(2026, 9, 14)
FEBRUARY = date(2027, 2, 22)


def current_on(day: date, code: str) -> list[str]:
    """The current editions of course `code` on `day`, as CODE:YEAR."""
    rows = with_current(CourseEdition.objects.select_related("course"), day)
    return sorted(str(e) for e in rows if e.course.code == code and getattr(e, IS_CURRENT))


@pytest.mark.parametrize(
    ("editions", "day", "expected"),
    [
        pytest.param(
            {"2025-2026": date(2026, 2, 23), "2026-2027": FEBRUARY},
            date(2027, 2, 21),
            ["B024251:2025-2026"],
            id="the-day-before-a-start",
        ),
        pytest.param(
            {"2025-2026": date(2026, 2, 23), "2026-2027": FEBRUARY},
            FEBRUARY,
            ["B024251:2026-2027"],
            id="on-the-start-day",
        ),
        pytest.param(
            {"2024-2025": date(2024, 9, 16), "2025-2026": date(2025, 9, 15)},
            SEPTEMBER,
            ["B024251:2025-2026"],
            id="the-later-of-two-started",
        ),
        pytest.param(
            {"2025-2026": date(2026, 2, 23), "2026-2027": None},
            date(2026, 8, 31),
            ["B024251:2025-2026"],
            id="no-start-day-before-september",
        ),
        pytest.param(
            {"2025-2026": date(2026, 2, 23), "2026-2027": None},
            date(2026, 9, 1),
            ["B024251:2026-2027"],
            id="no-start-day-from-september",
        ),
        pytest.param(
            {"2026-2027": FEBRUARY},
            SEPTEMBER,
            [],
            id="none-started",
        ),
    ],
)
def test_the_current_edition_is_the_newest_started(
    editions: dict[str, date | None], day: date, expected: list[str]
) -> None:
    course = Course.objects.create(code="B024251", name="Fisica II")
    for year, starts in editions.items():
        CourseEdition.objects.create(course=course, academic_year=year, teaching_starts=starts)
    # Another course's edition of a later year, started long ago: it is that
    # course's current one, and must not take the mark from this course's.
    other = Course.objects.create(code="B003725", name="Intelligenza Artificiale")
    CourseEdition.objects.create(
        course=other, academic_year="2027-2028", teaching_starts=date(2020, 1, 1)
    )

    assert current_on(day, "B024251") == expected
    assert current_on(day, "B003725") == ["B003725:2027-2028"]


def test_the_mark_reads_every_edition_in_the_same_query() -> None:
    course = Course.objects.create(code="B024251", name="Fisica II")
    CourseEdition.objects.create(
        course=course, academic_year="2025-2026", teaching_starts=date(2026, 2, 23)
    )
    newer = CourseEdition.objects.create(
        course=course, academic_year="2026-2027", teaching_starts=date(2026, 9, 14)
    )

    # A queryset holding only the older edition still finds the newer one started.
    older = CourseEdition.objects.exclude(pk=newer.pk)
    with CaptureQueriesContext(connection) as queries:
        marks = [getattr(e, IS_CURRENT) for e in with_current(older, date(2026, 10, 13))]

    assert marks == [False]
    assert len(queries) == 1
