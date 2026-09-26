"""The catalogue's invariants hold in the database, not only in forms.

Every refusal below is asserted by the name of the constraint PostgreSQL reports,
not merely by the exception class: an `IntegrityError` raised by some other
constraint than the one under test would otherwise pass for it. The rows are
shaped on PPM as UniFi lists it (docs/decisioni.md, 2026-09-25).
"""

from __future__ import annotations

import psycopg
import pytest
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme

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


def test_programme_code_is_unique(programme: DegreeProgramme) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        DegreeProgramme.objects.create(code=programme.code, name="Another name")

    assert (violation(excinfo.value).constraint_name or "").endswith("_code_key")


def test_course_code_is_unique(course: Course) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        Course.objects.create(code=course.code, name="Another name")

    assert (violation(excinfo.value).constraint_name or "").endswith("_code_key")


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


@pytest.mark.parametrize("academic_year", ["2025-2027", "2026-2025", "abcd-efgh", "", "2025-"])
def test_academic_year_validator_refuses_what_is_not_two_consecutive_years(
    course: Course, academic_year: str
) -> None:
    """Refused as a validation error on the field, never a crash on a malformed value."""
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


def test_current_editions_of_two_courses_coexist(course: Course) -> None:
    """The constraint is one current edition per course, not one in the whole table."""
    other = Course.objects.create(code="B003725", name="Intelligenza Artificiale")

    CourseEdition.objects.create(course=course, academic_year="2025-2026", is_current=True)
    CourseEdition.objects.create(course=other, academic_year="2025-2026", is_current=True)

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
    programme: DegreeProgramme, course: Course
) -> None:
    other = Course.objects.create(code="B003725", name="Intelligenza Artificiale")
    CurriculumEntry.objects.create(
        programme=programme,
        course=course,
        curriculum="TECNICO APPLICATIVO",
        year_of_study=3,
        ad_code="B028451",
    )

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CurriculumEntry.objects.create(
            programme=programme,
            course=other,
            curriculum="TECNICO APPLICATIVO",
            year_of_study=3,
            ad_code="B028451",
        )

    assert violation(excinfo.value).constraint_name == "catalog_entry_unique_ad_code"


def test_two_entries_with_empty_curriculum_and_same_ad_code_are_refused(
    programme: DegreeProgramme, course: Course
) -> None:
    """The reason "no curriculum" is an empty string: two NULLs would both be let in."""
    other = Course.objects.create(code="B003725", name="Intelligenza Artificiale")
    CurriculumEntry.objects.create(
        programme=programme, course=course, year_of_study=3, ad_code="B028451"
    )

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CurriculumEntry.objects.create(
            programme=programme, course=other, year_of_study=3, ad_code="B028451"
        )

    assert violation(excinfo.value).constraint_name == "catalog_entry_unique_ad_code"


def test_entry_is_unique_per_programme_curriculum_and_course(
    programme: DegreeProgramme, course: Course
) -> None:
    """A curriculum lists a course once, even where Cineca prints it under two codes."""
    CurriculumEntry.objects.create(
        programme=programme,
        course=course,
        curriculum="TECNICO APPLICATIVO",
        year_of_study=3,
        ad_code="B028451",
    )

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CurriculumEntry.objects.create(
            programme=programme,
            course=course,
            curriculum="TECNICO APPLICATIVO",
            year_of_study=3,
            ad_code="B003712",
        )

    assert violation(excinfo.value).constraint_name == "catalog_entry_unique_course"


def test_one_course_in_two_curricula_is_two_entries(
    programme: DegreeProgramme, course: Course
) -> None:
    """PPM as recorded: one course, each curriculum under the code specific to it."""
    CurriculumEntry.objects.create(
        programme=programme,
        course=course,
        curriculum="TECNICO APPLICATIVO",
        year_of_study=3,
        ad_code="B028451",
    )
    CurriculumEntry.objects.create(
        programme=programme,
        course=course,
        curriculum="TECNICO SCIENTIFICO",
        year_of_study=3,
        ad_code="B003712",
    )

    ad_codes = CurriculumEntry.objects.filter(course=course).values_list("ad_code", flat=True)
    assert sorted(ad_codes) == [
        "B003712",
        "B028451",
    ]


def test_curriculum_is_never_null(programme: DegreeProgramme, course: Course) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        CurriculumEntry.objects.create(
            programme=programme,
            course=course,
            curriculum=None,
            year_of_study=3,
            ad_code="B028451",
        )

    assert violation(excinfo.value).column_name == "curriculum"


@pytest.mark.parametrize("year_of_study", [0, 7])
def test_year_of_study_is_bounded(
    programme: DegreeProgramme, course: Course, year_of_study: int
) -> None:
    entry = CurriculumEntry(
        programme=programme, course=course, year_of_study=year_of_study, ad_code="B028451"
    )

    with pytest.raises(ValidationError) as excinfo:
        entry.full_clean()

    assert "year_of_study" in excinfo.value.error_dict


def test_names_carry_the_project_locale(programme: DegreeProgramme, course: Course) -> None:
    """The rows with a user-visible name carry the language it is written in."""
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
    programme: DegreeProgramme, course: Course
) -> None:
    edition = CourseEdition.objects.create(course=course, academic_year="2025-2026")
    entry = CurriculumEntry.objects.create(
        programme=programme, course=course, year_of_study=3, ad_code="B003712"
    )

    assert str(programme) == "[B047] Ingegneria Informatica"
    assert str(course) == "[B028451] Progettazione e Produzione Multimediale"
    assert str(edition) == "B028451:2025-2026"
    assert str(entry) == "B003712 (B047)"
