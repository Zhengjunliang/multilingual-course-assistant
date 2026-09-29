"""The admin is how the catalogue is entered and how an edition is switched.

These tests drive `apps/catalog/admin.py` through `admin_client`, the way the
superuser does: HTTP POSTs to the add and change pages, and to the
`set_as_current` action on the changelist. They do not touch `set_current()`
directly — `tests/test_catalog_editions.py` already owns that — the point
here is that the admin wires read-only fields and the action to it correctly,
and that it admits nobody but a superuser (config/admin.py).
"""

from __future__ import annotations

import pytest
from django.contrib.auth.models import Permission
from django.urls import reverse

from apps.accounts.models import User
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme

pytestmark = pytest.mark.django_db


@pytest.fixture
def programme() -> DegreeProgramme:
    return DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")


@pytest.fixture
def course() -> Course:
    return Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")


@pytest.fixture
def other_course() -> Course:
    return Course.objects.create(code="B003725", name="Intelligenza Artificiale")


@pytest.mark.parametrize("case", ["one", "two", "staff-not-superuser"])
def test_set_as_current_action_needs_one_edition_and_a_superuser(
    admin_client, client, course: Course, case: str
) -> None:
    first = CourseEdition.objects.create(course=course, academic_year="2024-2025")
    second = CourseEdition.objects.create(course=course, academic_year="2025-2026")
    pks = [first.pk, second.pk] if case == "two" else [first.pk]
    poster = admin_client
    if case == "staff-not-superuser":
        # Even holding the change permission the action names: the site turns
        # the account away before any model admin is asked.
        staff = User.objects.create_user(username="staff", is_staff=True)
        staff.user_permissions.add(
            Permission.objects.get(
                content_type__app_label="catalog", codename="change_courseedition"
            )
        )
        client.force_login(staff)
        poster = client

    response = poster.post(
        reverse("admin:catalog_courseedition_changelist"),
        {"action": "set_as_current", "_selected_action": pks},
        follow=True,
    )

    first.refresh_from_db()
    second.refresh_from_db()
    if case == "one":
        assert first.is_current is True
        assert second.is_current is False
        return
    assert first.is_current is False
    assert second.is_current is False
    if case == "two":
        assert "Select exactly one edition to switch." in response.content.decode()
    else:
        assert response.redirect_chain[0][0].startswith(reverse("admin:login"))


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


def test_admin_add_page_cannot_set_is_current(admin_client, course: Course) -> None:
    response = admin_client.post(
        reverse("admin:catalog_courseedition_add"),
        {"course": course.pk, "academic_year": "2025-2026", "is_current": "on"},
    )

    assert response.status_code == 302
    edition = CourseEdition.objects.get(course=course, academic_year="2025-2026")
    assert edition.is_current is False


@pytest.mark.parametrize(
    "case",
    ["edition-course", "edition-year", "edition-is_current", "course-code"],
)
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
            {"code": "ZZZZZZZ", "name": "New PPM Name", "locale": "it"},
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
        "edition-is_current": {"is_current": "on"},
    }[case]

    response = admin_client.post(
        reverse("admin:catalog_courseedition_change", args=[edition.pk]), new_value
    )

    assert response.status_code == 302
    edition.refresh_from_db()
    assert edition.course == course
    assert edition.academic_year == "2024-2025"
    assert edition.is_current is False


def test_ppm_rows_can_be_entered_through_the_admin(admin_client) -> None:
    responses = [
        admin_client.post(
            reverse("admin:catalog_degreeprogramme_add"),
            {"code": "B047", "name": "Ingegneria Informatica", "locale": "it"},
        ),
        admin_client.post(
            reverse("admin:catalog_course_add"),
            {"code": "B028451", "name": "Progettazione e Produzione Multimediale", "locale": "it"},
        ),
    ]
    programme = DegreeProgramme.objects.get(code="B047")
    course = Course.objects.get(code="B028451")

    responses.append(
        admin_client.post(
            reverse("admin:catalog_courseedition_add"),
            {"course": course.pk, "academic_year": "2025-2026"},
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

    action_response = admin_client.post(
        reverse("admin:catalog_courseedition_changelist"),
        {"action": "set_as_current", "_selected_action": [edition.pk]},
    )
    assert action_response.status_code == 302

    assert CurriculumEntry.objects.filter(course__code="B028451").count() == 2
    current = CourseEdition.objects.get(course=course, is_current=True)
    assert str(current) == "B028451:2025-2026"
