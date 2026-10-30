"""What a signed-in caller's question searches, and what they may read (apps/qa/scope.py).

Read through `world()` of tests/test_roles.py, whose start days count from
today: B047 lists PPM, whose three editions are past, current and starting in
a month, and a course it shares with L031; L031 lists IA too. The question
endpoint and the deck endpoint that use these sets are tests/test_qa_api.py's
and tests/test_sources_api.py's.

`offer` and `declare` build the catalogue rows and the declared programme
those files need.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from test_roles import world

from apps.accounts.models import StudentProgramme
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.qa.scope import boundary, is_default, search_scope
from rag.chunk import EditionKey

if TYPE_CHECKING:
    from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def offer(programme: str, course: str, *academic_years: str) -> list[CourseEdition]:
    """`course`, listed by `programme`, both created when missing, and its
    editions of `academic_years`, undated: each counts from 1 September of its
    first year (apps/catalog/editions.py)."""
    degree, _ = DegreeProgramme.objects.get_or_create(code=programme, defaults={"name": programme})
    listed, _ = Course.objects.get_or_create(code=course, defaults={"name": course})
    CurriculumEntry.objects.get_or_create(
        programme=degree, course=listed, defaults={"year_of_study": 1, "ad_code": course}
    )
    return [
        CourseEdition.objects.get_or_create(course=listed, academic_year=year)[0]
        for year in academic_years
    ]


def declare(user: User, programme: str, year: int | None = None) -> None:
    """`user` says they study in `programme`, in `year` if given, as registration records it."""
    StudentProgramme.objects.create(
        user=user, programme=DegreeProgramme.objects.get(code=programme), year_of_study=year
    )


def key(edition: CourseEdition) -> EditionKey:
    return EditionKey(edition.course.code, edition.academic_year)


def searched(user: User) -> set[EditionKey]:
    """What `user`'s question searches when its conversation added nothing."""
    return set(search_scope(boundary(user), set()))


def test_default_scope_is_current_editions_of_the_programme() -> None:
    """The started editions of the programme's courses are readable, the
    current one of each is searched; a past year only once added."""
    w = world()
    declare(w.student, "B047")

    with CaptureQueriesContext(connection) as captured:
        readable = list(boundary(w.student))

    assert len(captured.captured_queries) == 1
    assert {e.pk for e in readable} == {w.ppm_past.pk, w.ppm_old.pk, w.shared.pk}
    assert searched(w.student) == {key(w.ppm_old), key(w.shared)}
    assert set(search_scope(readable, {w.ppm_past.pk})) == {
        key(w.ppm_past),
        key(w.ppm_old),
        key(w.shared),
    }


def test_course_without_current_edition_is_left_out() -> None:
    """A course whose one edition has not started is neither searched nor
    readable by a student: its deck is its teachers' until teaching starts."""
    w = world()
    (upcoming,) = offer("B047", "B000002", "2025-2026")
    upcoming.teaching_starts = timezone.localdate() + timedelta(days=30)
    upcoming.save()
    declare(w.student, "B047")

    assert upcoming.pk not in {e.pk for e in boundary(w.student)}
    assert "B000002" not in {edition.course for edition in searched(w.student)}


def test_teacher_scope_includes_their_upcoming_edition() -> None:
    """A teacher assigned to next year's edition alone reads every year of
    the course, and searches the current one and the one not started yet, so
    a deck uploaded for it can be tried at once."""
    w = world()

    readable = {e.pk: e for e in boundary(w.newcomer)}

    assert set(readable) == {w.ppm_past.pk, w.ppm_old.pk, w.ppm_new.pk}
    assert not is_default(readable[w.ppm_past.pk])
    assert searched(w.newcomer) == {key(w.ppm_old), key(w.ppm_new)}


def test_superuser_default_is_every_current_edition() -> None:
    """Every edition is readable, and each course's current one is searched."""
    w = world()

    assert boundary(w.root).count() == CourseEdition.objects.count()
    assert searched(w.root) == {key(w.ppm_old), key(w.ia), key(w.shared)}


def test_no_programme_no_role_is_empty() -> None:
    """An account that declared no programme and holds no role reads no
    edition: its questions are answered from the campus pages alone."""
    w = world()

    assert not boundary(w.student).exists()
    assert search_scope(boundary(w.student), set()) == []
