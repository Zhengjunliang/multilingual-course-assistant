"""An edition's syllabus and reading list keep their rules in the database.

A refusal is asserted by the name of the constraint PostgreSQL reports, as in
tests/test_catalog_models.py: a value outside a closed set, an empty section,
a second row for the same key. The rows are FISICA II's, as the course
catalogue shows them for 2026/2027.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from test_catalog_models import violation

from apps.catalog.models import (
    Course,
    CourseEdition,
    Importance,
    ReadingItem,
    Syllabus,
    SyllabusSection,
)

pytestmark = pytest.mark.django_db

BOOK = {
    "title": "Elementi di Fisica - elettromagnetismo e onde",
    "authors": "Mazzoldi, Nigro, Voci",
}


@pytest.fixture
def edition() -> CourseEdition:
    course = Course.objects.create(code="B024251", name="FISICA II")
    return CourseEdition.objects.create(course=course, academic_year="2026-2027")


@pytest.mark.parametrize(
    ("model", "fields", "constraint"),
    [
        pytest.param(
            Syllabus,
            {"section": "testi", "text": "Mazzoldi, Nigro, Voci"},
            "catalog_syllabus_section_known",
            id="the-reading-list-as-a-section",
        ),
        pytest.param(
            Syllabus,
            {"section": SyllabusSection.PREREQUISITI, "text": ""},
            "catalog_syllabus_text_not_empty",
            id="an-empty-section",
        ),
        pytest.param(
            ReadingItem,
            {**BOOK, "importance": "optional"},
            "catalog_reading_importance_known",
            id="an-unknown-importance",
        ),
    ],
)
def test_a_value_outside_the_rules_is_refused(
    edition: CourseEdition,
    model: type[Syllabus | ReadingItem],
    fields: dict[str, Any],
    constraint: str,
) -> None:
    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        model.objects.create(edition=edition, **fields)

    assert violation(excinfo.value).constraint_name == constraint


def test_a_section_is_stored_once_per_edition(edition: CourseEdition) -> None:
    """The syllabus has one language, the edition's, so a section has one text."""
    Syllabus.objects.create(edition=edition, section=SyllabusSection.PREREQUISITI, text="Fisica I")

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        Syllabus.objects.create(
            edition=edition, section=SyllabusSection.PREREQUISITI, text="Physics I"
        )

    assert violation(excinfo.value).constraint_name == "catalog_syllabus_unique_section"


def test_a_title_is_listed_once_per_edition_whatever_its_language(edition: CourseEdition) -> None:
    ReadingItem.objects.create(
        edition=edition, locale="it", importance=Importance.RECOMMENDED, **BOOK
    )

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        ReadingItem.objects.create(
            edition=edition, locale="en", importance=Importance.REQUIRED, **BOOK
        )

    assert violation(excinfo.value).constraint_name == "catalog_reading_unique_title"


@pytest.mark.parametrize(("locale", "valid"), [("de", True), ("zh-hant", True), ("xx", False)])
def test_a_book_is_in_a_language_django_knows(
    edition: CourseEdition, locale: str, valid: bool
) -> None:
    """Wider than the site's three: a reading list can hold a German textbook."""
    book = ReadingItem(edition=edition, locale=locale, importance=Importance.RECOMMENDED, **BOOK)

    if valid:
        book.full_clean()
    else:
        with pytest.raises(ValidationError) as excinfo:
            book.full_clean()
        assert "locale" in excinfo.value.error_dict


def test_a_book_needs_no_year_isbn_or_link_and_goes_with_its_edition(
    edition: CourseEdition,
) -> None:
    book = ReadingItem(edition=edition, importance=Importance.RECOMMENDED, **BOOK)
    book.full_clean()
    book.save()
    Syllabus.objects.create(edition=edition, section=SyllabusSection.PREREQUISITI, text="Fisica I")

    edition.delete()

    assert (ReadingItem.objects.count(), Syllabus.objects.count()) == (0, 0)
