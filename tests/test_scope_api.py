"""`GET /api/scope`: the course list a conversation adds editions from (apps/qa/scope_views.py).

Read through `world()` of tests/test_roles.py: B047 lists the shared course in
its first year and PPM in its third, PPM's three editions past, current and
starting in a month; L031 lists IA. Which editions a caller reads is
tests/test_scope.py's; who may call the endpoint at all, tests/access_matrix.txt's.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from test_qa_api import client_for
from test_roles import world
from test_scope import declare

from apps.qa.scope_serializers import ScopeCourseSerializer
from apps.qa.scope_views import listed

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import CourseEdition

pytestmark = pytest.mark.django_db

PPM, SHARED, IA = "B028451", "B000001", "B003725"


def courses(user: User) -> list[dict[str, Any]]:
    response = client_for(user=user).get(reverse("qa:scope"))
    assert response.status_code == 200
    return response.json()


def shown(edition: CourseEdition, state: str, *, default: bool) -> dict[str, Any]:
    return {
        "id": edition.pk,
        "academic_year": edition.academic_year,
        "state": state,
        "default": default,
    }


def test_course_list_puts_own_year_first() -> None:
    """A third-year student finds PPM above the first year's course, and its
    past edition offered beside the current one it searches already."""
    w = world()
    declare(w.student, "B047", year=3)

    listed_courses = courses(w.student)

    assert [course["code"] for course in listed_courses] == [PPM, SHARED]
    assert listed_courses[0] == {
        "code": PPM,
        "name": "Progettazione e Produzione Multimediale",
        "locale": "it",
        "year_of_study": 3,
        "editions": [
            shown(w.ppm_old, "current", default=True),
            shown(w.ppm_past, "past", default=False),
        ],
    }


def test_without_a_year_the_courses_are_the_same_in_the_programmes_order() -> None:
    w = world()
    declare(w.student, "B047")

    assert [course["code"] for course in courses(w.student)] == [SHARED, PPM]


def test_a_course_only_a_role_brings_comes_last_with_no_year() -> None:
    """B047's secretariat who teaches IA and studies in B047's first year: IA
    is no course of the programme; PPM's next year is the secretariat's to read
    and to add, not to search unadded."""
    w = world()
    declare(w.dual, "B047", year=1)

    listed_courses = courses(w.dual)

    assert [(c["code"], c["year_of_study"]) for c in listed_courses] == [
        (SHARED, 1),
        (PPM, 3),
        (IA, None),
    ]
    assert listed_courses[1]["editions"] == [
        shown(w.ppm_new, "upcoming", default=False),
        shown(w.ppm_old, "current", default=True),
        shown(w.ppm_past, "past", default=False),
    ]


def test_a_teacher_searches_their_upcoming_edition_unadded() -> None:
    w = world()

    (ppm,) = courses(w.newcomer)

    assert ppm["editions"] == [
        shown(w.ppm_new, "upcoming", default=True),
        shown(w.ppm_old, "current", default=True),
        shown(w.ppm_past, "past", default=False),
    ]


def test_no_programme_and_no_role_lists_nothing() -> None:
    assert courses(world().student) == []


def test_the_list_is_two_queries_however_many_courses() -> None:
    w = world()
    declare(w.root, "B047", year=1)

    with CaptureQueriesContext(connection) as captured:
        data = ScopeCourseSerializer(listed(w.root), many=True).data

    assert len(captured.captured_queries) == 2
    assert [course["code"] for course in data] == [SHARED, PPM, IA]
