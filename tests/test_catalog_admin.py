"""The admin is how the catalogue is entered.

These tests drive `apps/catalog/admin.py` through `admin_client`, the way the
superuser does: HTTP POSTs to the add and change pages. The point is that the
admin keeps a saved edition's key read-only, takes its teaching start, and
admits nobody but a superuser (config/admin.py).
"""

from __future__ import annotations

import datetime

import pytest
from django.urls import reverse

from apps.accounts.models import User
from apps.catalog.models import (
    Course,
    CourseEdition,
    CurriculumEntry,
    DegreeProgramme,
    ReadingItem,
    Syllabus,
)

pytestmark = pytest.mark.django_db

# An edition's form carries its syllabus and reading list inlines, which the
# admin refuses to save without their management forms; none of them filled.
NO_INLINES = {
    f"{prefix}-{field}": "0"
    for prefix in ("syllabus", "reading_items")
    for field in ("TOTAL_FORMS", "INITIAL_FORMS")
}


@pytest.fixture
def programme() -> DegreeProgramme:
    return DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")


@pytest.fixture
def course() -> Course:
    return Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")


@pytest.fixture
def other_course() -> Course:
    return Course.objects.create(code="B003725", name="Intelligenza Artificiale")


@pytest.mark.parametrize(
    ("who", "expected"),
    [
        pytest.param("superuser", (200, "", True), id="superuser"),
        pytest.param("staff", (302, "/admin/login/", False), id="staff-not-superuser"),
        pytest.param("user", (302, "/admin/login/", False), id="ordinary-user"),
    ],
)
def test_the_admin_admits_superusers_only(
    client, who: str, expected: tuple[int, str, bool]
) -> None:
    user = (
        User.objects.create_superuser(username=who)
        if who == "superuser"
        else User.objects.create_user(username=who, is_staff=who == "staff")
    )
    client.force_login(user)

    response = client.get(reverse("admin:index"))

    page = response.content.decode()
    lists_both = all(
        reverse(f"admin:{model}_changelist") in page
        for model in ("catalog_courseedition", "roles_roleassignment")
    )
    assert (
        response.status_code,
        response.get("Location", "").split("?")[0],
        lists_both,
    ) == expected


@pytest.mark.parametrize("case", ["edition-course", "edition-year", "course-code"])
def test_saved_keys_are_read_only_in_the_admin(
    admin_client, programme: DegreeProgramme, course: Course, other_course: Course, case: str
) -> None:
    if case == "course-code":
        # B028451's own TA entry lists B028451 as its ad_code, which
        # Course.clean() must not take for a conflict: an edit of this course
        # saves, with no error on a code the form does not show.
        CurriculumEntry.objects.create(
            programme=programme,
            course=course,
            curriculum="TECNICO APPLICATIVO",
            year_of_study=3,
            ad_code=course.code,
        )

        response = admin_client.post(
            reverse("admin:catalog_course_change", args=[course.pk]),
            {"code": "ZZZZZZZ", "name": "New PPM Name", "locale": "it", "code_source": "moodle"},
        )

        assert response.status_code == 302
        course.refresh_from_db()
        assert course.name == "New PPM Name"
        assert course.code == "B028451"
        return

    edition = CourseEdition.objects.create(course=course, academic_year="2024-2025")
    new_value = {
        "edition-course": {"course": other_course.pk},
        "edition-year": {"academic_year": "2099-2100"},
    }[case]

    response = admin_client.post(
        reverse("admin:catalog_courseedition_change", args=[edition.pk]),
        {"syllabus_locale": "it", **new_value, **NO_INLINES},
    )

    assert response.status_code == 302
    edition.refresh_from_db()
    assert edition.course == course
    assert edition.academic_year == "2024-2025"


def test_an_edition_is_entered_with_its_syllabus_and_reading_list(
    admin_client, course: Course
) -> None:
    edition = CourseEdition.objects.create(course=course, academic_year="2026-2027")
    url = reverse("admin:catalog_courseedition_change", args=[edition.pk])
    inlines = {
        **NO_INLINES,
        "syllabus_locale": "it",
        "syllabus-TOTAL_FORMS": "1",
        "syllabus-0-section": "prerequisiti",
        "syllabus-0-text": "Fisica I, Analisi matematica I",
        "reading_items-TOTAL_FORMS": "1",
        "reading_items-0-locale": "it",
        "reading_items-0-title": "Elementi di Fisica",
        "reading_items-0-authors": "Mazzoldi, Nigro, Voci",
        "reading_items-0-url": "www.example.org/fisica",
        "reading_items-0-importance": "recommended",
    }

    response = admin_client.post(url, inlines)

    assert response.status_code == 302
    assert list(Syllabus.objects.filter(edition=edition).values_list("section", "text")) == [
        ("prerequisiti", "Fisica I, Analisi matematica I")
    ]
    assert list(ReadingItem.objects.filter(edition=edition).values_list("title", "url")) == [
        ("Elementi di Fisica", "https://www.example.org/fisica")
    ]


def test_ppm_rows_can_be_entered_through_the_admin(admin_client) -> None:
    responses = [
        admin_client.post(
            reverse("admin:catalog_degreeprogramme_add"),
            {"code": "B047", "name": "Ingegneria Informatica", "locale": "it"},
        ),
        admin_client.post(
            reverse("admin:catalog_course_add"),
            {
                "code": "B028451",
                "name": "Progettazione e Produzione Multimediale",
                "locale": "it",
                "code_source": "moodle",
            },
        ),
    ]
    programme = DegreeProgramme.objects.get(code="B047")
    course = Course.objects.get(code="B028451")

    responses.append(
        admin_client.post(
            reverse("admin:catalog_courseedition_add"),
            {
                "course": course.pk,
                "academic_year": "2025-2026",
                "teaching_starts": "2026-02-23",
                "period": "second_semester",
                "syllabus_locale": "it",
                **NO_INLINES,
            },
        )
    )
    edition = CourseEdition.objects.get(course=course, academic_year="2025-2026")

    responses.append(
        admin_client.post(
            reverse("admin:catalog_curriculumentry_add"),
            {
                "programme": programme.pk,
                "course": course.pk,
                "curriculum": "TECNICO APPLICATIVO",
                "year_of_study": 3,
                "ad_code": "B028451",
            },
        )
    )
    responses.append(
        admin_client.post(
            reverse("admin:catalog_curriculumentry_add"),
            {
                "programme": programme.pk,
                "course": course.pk,
                "curriculum": "TECNICO SCIENTIFICO",
                "year_of_study": 3,
                "ad_code": "B003712",
            },
        )
    )
    assert all(response.status_code == 302 for response in responses)

    assert CurriculumEntry.objects.filter(course__code="B028451").count() == 2
    assert edition.teaching_starts == datetime.date(2026, 2, 23)
    # The course list says where each code comes from, as the staff pages do.
    changelist = admin_client.get(reverse("admin:catalog_course_changelist"))
    assert "Moodle course" in changelist.content.decode()
