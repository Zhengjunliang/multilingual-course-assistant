"""The catalogue's invariants hold in the database, not only in forms.

A refusal the database makes is asserted by the name of the constraint
PostgreSQL reports, not merely by the exception class: an `IntegrityError`
raised by some other constraint would otherwise pass for the one under test.
The rules kept in validators — consecutive years, the year of study, the
language — are asserted through `full_clean`, on the field they belong to. The
rows are shaped on PPM as UniFi lists it (docs/decisioni.md, 2026-09-25, *PPM
read from Moodle and Cineca*).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import psycopg
import pytest
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme

if TYPE_CHECKING:
    from collections.abc import Callable

pytestmark = pytest.mark.django_db


def violation(error: IntegrityError) -> psycopg.errors.Diagnostic:
    """What PostgreSQL says it refused, read from the driver error Django wraps."""
    cause = error.__cause__
    assert isinstance(cause, psycopg.Error)
    return cause.diag


@pytest.fixture
def programme() -> DegreeProgramme:
    return DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")


@pytest.fixture
def course() -> Course:
    return Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")


@pytest.fixture
def other_course() -> Course:
    return Course.objects.create(code="B003725", name="Intelligenza Artificiale")


@pytest.fixture
def entry(programme: DegreeProgramme, course: Course) -> Callable[..., CurriculumEntry]:
    """Saves an entry shaped on PPM's first one; a test overrides what it is about."""

    def make(**overrides: object) -> CurriculumEntry:
        fields: dict[str, object] = {
            "programme": programme,
            "course": course,
            "curriculum": "TECNICO APPLICATIVO",
            "year_of_study": 3,
            "ad_code": "B028451",
        }
        return CurriculumEntry.objects.create(**(fields | overrides))

    return make


def test_programme_code_is_unique(programme: DegreeProgramme) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        DegreeProgramme.objects.create(code=programme.code, name="Another name")

    assert violation(excinfo.value).constraint_name == "catalog_degreeprogramme_code_key"


def test_course_code_is_unique(course: Course) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        Course.objects.create(code=course.code, name="Another name")

    assert violation(excinfo.value).constraint_name == "catalog_course_code_key"


def test_edition_is_unique_per_course_and_year(course: Course) -> None:
    CourseEdition.objects.create(course=course, academic_year="2025-2026")

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CourseEdition.objects.create(course=course, academic_year="2025-2026")

    assert violation(excinfo.value).constraint_name == "catalog_edition_unique_course_year"


@pytest.mark.parametrize("academic_year", ["2025/2026", "25-26", "2025-26", "2025-202a"])
def test_edition_academic_year_must_match_the_format(course: Course, academic_year: str) -> None:
    """The shape is a database rule; `create` skips validators, so this reaches it."""
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CourseEdition.objects.create(course=course, academic_year=academic_year)

    assert violation(excinfo.value).constraint_name == "catalog_edition_academic_year_format"


@pytest.mark.parametrize(
    "academic_year",
    [
        pytest.param("2025-2027", id="gap"),
        pytest.param("2026-2025", id="backwards"),
        pytest.param("abcd-efgh", id="letters"),
        pytest.param("2025-", id="truncated"),
        pytest.param("٢٠٢٥-٢٠٢٦", id="non-ascii-digits"),
    ],
)
def test_academic_year_validator_refuses_what_is_not_two_consecutive_years(
    course: Course, academic_year: str
) -> None:
    """Refused on the field, which only the validator reports: the database
    constraint, run by `full_clean` too, reports a non-field error."""
    edition = CourseEdition(course=course, academic_year=academic_year)

    with pytest.raises(ValidationError) as excinfo:
        edition.full_clean()

    assert "academic_year" in excinfo.value.error_dict


def test_academic_year_validator_accepts_two_consecutive_years(course: Course) -> None:
    CourseEdition(course=course, academic_year="2025-2026").full_clean()


def test_second_current_edition_of_a_course_is_refused(course: Course) -> None:
    CourseEdition.objects.create(course=course, academic_year="2024-2025", is_current=True)

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CourseEdition.objects.create(course=course, academic_year="2025-2026", is_current=True)

    assert violation(excinfo.value).constraint_name == "catalog_edition_one_current_per_course"


def test_current_editions_of_two_courses_coexist(course: Course, other_course: Course) -> None:
    """The constraint is one current edition per course, not one in the whole table."""
    CourseEdition.objects.create(course=course, academic_year="2025-2026", is_current=True)
    CourseEdition.objects.create(course=other_course, academic_year="2025-2026", is_current=True)

    assert CourseEdition.objects.filter(is_current=True).count() == 2


def test_past_editions_of_a_course_coexist_with_its_current_one(course: Course) -> None:
    CourseEdition.objects.create(course=course, academic_year="2024-2025")
    CourseEdition.objects.create(course=course, academic_year="2023-2024")
    CourseEdition.objects.create(course=course, academic_year="2025-2026", is_current=True)

    assert CourseEdition.objects.filter(course=course).count() == 3


def test_a_course_with_editions_cannot_be_deleted(course: Course) -> None:
    """An edition will own material indexed outside PostgreSQL, which no cascade reaches."""
    CourseEdition.objects.create(course=course, academic_year="2025-2026")

    with pytest.raises(ProtectedError):
        course.delete()


def test_entry_is_unique_per_programme_curriculum_and_ad_code(
    entry: Callable[..., CurriculumEntry], other_course: Course
) -> None:
    entry()

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        entry(course=other_course)

    assert violation(excinfo.value).constraint_name == "catalog_entry_unique_ad_code"


def test_two_entries_with_empty_curriculum_and_same_ad_code_are_refused(
    entry: Callable[..., CurriculumEntry], other_course: Course
) -> None:
    """The reason "no curriculum" is an empty string: two NULLs would both be let in."""
    entry(curriculum="")

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        entry(course=other_course, curriculum="")

    assert violation(excinfo.value).constraint_name == "catalog_entry_unique_ad_code"


def test_entry_is_unique_per_programme_curriculum_and_course(
    entry: Callable[..., CurriculumEntry],
) -> None:
    """A curriculum lists a course once, even where Cineca prints it under two codes."""
    entry()

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        entry(ad_code="B003712")

    assert violation(excinfo.value).constraint_name == "catalog_entry_unique_course"


def test_one_course_in_two_curricula_is_two_entries(
    entry: Callable[..., CurriculumEntry], course: Course
) -> None:
    """PPM as recorded: one course, each curriculum under the code specific to it."""
    entry()
    entry(curriculum="TECNICO SCIENTIFICO", ad_code="B003712")

    ad_codes = CurriculumEntry.objects.filter(course=course).values_list("ad_code", flat=True)
    assert sorted(ad_codes) == ["B003712", "B028451"]


def test_curriculum_is_never_null(entry: Callable[..., CurriculumEntry]) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        entry(curriculum=None)

    assert violation(excinfo.value).column_name == "curriculum"


@pytest.mark.parametrize("year_of_study", [0, 7])
def test_year_of_study_is_bounded(
    programme: DegreeProgramme, course: Course, year_of_study: int
) -> None:
    row = CurriculumEntry(
        programme=programme, course=course, year_of_study=year_of_study, ad_code="B028451"
    )

    with pytest.raises(ValidationError) as excinfo:
        row.full_clean()

    assert "year_of_study" in excinfo.value.error_dict


def test_names_carry_the_project_locale(programme: DegreeProgramme, course: Course) -> None:
    """The rows with a user-visible name store the language it is written in."""
    programme.refresh_from_db()
    course.refresh_from_db()

    assert programme.locale == settings.LANGUAGE_CODE
    assert course.locale == settings.LANGUAGE_CODE


@pytest.mark.parametrize("model", [DegreeProgramme, Course])
def test_locale_rejects_a_language_the_project_does_not_serve(
    model: type[DegreeProgramme] | type[Course],
) -> None:
    """`choices` is only enforced through validation, so the enforcement is what is tested."""
    row = model(code="B999999", name="Any", locale="xx")

    with pytest.raises(ValidationError) as excinfo:
        row.full_clean()

    assert "locale" in excinfo.value.error_dict


def test_str_names_rows_the_way_the_university_does(
    programme: DegreeProgramme, course: Course, entry: Callable[..., CurriculumEntry]
) -> None:
    edition = CourseEdition.objects.create(course=course, academic_year="2025-2026")

    assert str(programme) == "[B047] Ingegneria Informatica"
    assert str(course) == "[B028451] Progettazione e Produzione Multimediale"
    assert str(edition) == "B028451:2025-2026"
    assert str(entry(curriculum="", ad_code="B003712")) == "B003712 (B047)"
