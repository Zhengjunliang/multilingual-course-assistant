"""Role rows: a role fits its scope, a grant is stored once, and it goes with its scope.

A refusal the database makes is asserted by the name of the constraint
PostgreSQL reports, as in tests/test_catalog_models.py. `world()` is the one
set of people and scopes these tests share: every user is created without a
password, so none of them costs a password hash.
"""

from __future__ import annotations

from typing import NamedTuple

import pytest
from django.db import IntegrityError, transaction
from test_catalog_models import violation

from apps.accounts.models import User
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role

pytestmark = pytest.mark.django_db


class World(NamedTuple):
    b047: DegreeProgramme
    l031: DegreeProgramme
    ppm_old: CourseEdition
    ppm_new: CourseEdition
    ia: CourseEdition
    shared: CourseEdition
    continuing: User
    newcomer: User
    secretariat: User
    other_secretariat: User
    dual: User
    student: User
    root: User
    inactive: User


def world() -> World:
    """Two programmes, three courses, four editions, and one user per way of holding a role.

    PPM is offered by B047 alone and runs in two years, the older one current;
    IA is offered by L031 alone; the shared course is offered by both. The
    users: a teacher of both PPM years, a teacher of the new year only, the
    secretariat of each programme, a teacher of IA who is also B047's
    secretariat, a student with no role, the superuser, and a B047 secretariat
    member whose account is disabled.
    """
    b047 = DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")
    l031 = DegreeProgramme.objects.create(code="L031", name="Informatica")
    ppm = Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")
    ia = Course.objects.create(code="B003725", name="Intelligenza Artificiale")
    shared = Course.objects.create(code="B000001", name="Analisi Matematica I")
    CurriculumEntry.objects.bulk_create(
        [
            CurriculumEntry(programme=b047, course=ppm, year_of_study=3, ad_code="B028451"),
            CurriculumEntry(programme=l031, course=ia, year_of_study=3, ad_code="B003725"),
            CurriculumEntry(programme=b047, course=shared, year_of_study=1, ad_code="B000001"),
            CurriculumEntry(programme=l031, course=shared, year_of_study=1, ad_code="B000001"),
        ]
    )
    ppm_old = CourseEdition.objects.create(course=ppm, academic_year="2024-2025", is_current=True)
    ppm_new = CourseEdition.objects.create(course=ppm, academic_year="2025-2026")
    ia_edition = CourseEdition.objects.create(course=ia, academic_year="2025-2026", is_current=True)
    shared_edition = CourseEdition.objects.create(
        course=shared, academic_year="2025-2026", is_current=True
    )

    users = {
        name: User.objects.create_user(username=name)
        for name in (
            "continuing",
            "newcomer",
            "secretariat",
            "other_secretariat",
            "dual",
            "student",
        )
    }
    users["inactive"] = User.objects.create_user(username="inactive", is_active=False)
    # Not "admin": pytest-django's admin_user fixture takes that name.
    users["root"] = User.objects.create_superuser(username="root")

    teacher, secretariat = Role.TEACHER, Role.SECRETARIAT
    RoleAssignment.objects.bulk_create(
        [
            RoleAssignment(user=users["continuing"], role=teacher, edition=ppm_old),
            RoleAssignment(user=users["continuing"], role=teacher, edition=ppm_new),
            RoleAssignment(user=users["newcomer"], role=teacher, edition=ppm_new),
            RoleAssignment(user=users["secretariat"], role=secretariat, programme=b047),
            RoleAssignment(user=users["other_secretariat"], role=secretariat, programme=l031),
            RoleAssignment(user=users["dual"], role=teacher, edition=ia_edition),
            RoleAssignment(user=users["dual"], role=secretariat, programme=b047),
            RoleAssignment(user=users["inactive"], role=secretariat, programme=b047),
        ]
    )
    return World(
        b047=b047,
        l031=l031,
        ppm_old=ppm_old,
        ppm_new=ppm_new,
        ia=ia_edition,
        shared=shared_edition,
        **users,
    )


@pytest.mark.parametrize(
    ("role", "on_edition", "on_programme"),
    [
        pytest.param(Role.TEACHER, False, True, id="teacher-on-a-programme"),
        pytest.param(Role.TEACHER, True, True, id="teacher-on-both"),
        pytest.param(Role.TEACHER, False, False, id="teacher-on-nothing"),
        pytest.param(Role.SECRETARIAT, True, False, id="secretariat-on-an-edition"),
        pytest.param(Role.SECRETARIAT, True, True, id="secretariat-on-both"),
        pytest.param("student", True, False, id="unknown-role"),
    ],
)
def test_a_role_row_fits_its_scope(role: str, on_edition: bool, on_programme: bool) -> None:
    w = world()

    with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
        RoleAssignment.objects.create(
            user=w.student,
            role=role,
            edition=w.ppm_new if on_edition else None,
            programme=w.b047 if on_programme else None,
        )

    assert violation(excinfo.value).constraint_name == "roles_assignment_scope_fits_role"


def test_one_row_per_user_role_and_scope() -> None:
    w = world()

    # Both shapes, since each leaves a different scope column NULL: the
    # constraint holds only because NULLs are not distinct in it.
    for duplicate in (
        {"user": w.newcomer, "role": Role.TEACHER, "edition": w.ppm_new},
        {"user": w.secretariat, "role": Role.SECRETARIAT, "programme": w.b047},
    ):
        with pytest.raises(IntegrityError) as excinfo, transaction.atomic():
            RoleAssignment.objects.create(**duplicate)
        assert violation(excinfo.value).constraint_name == "roles_assignment_unique"

    # One role on two scopes, and two roles for one person, are separate facts.
    assert RoleAssignment.objects.filter(user=w.continuing).count() == 2
    assert set(RoleAssignment.objects.filter(user=w.dual).values_list("role", flat=True)) == {
        Role.TEACHER,
        Role.SECRETARIAT,
    }


def test_deleting_a_scope_or_a_user_deletes_its_role_rows() -> None:
    w = world()

    w.ppm_new.delete()
    w.l031.delete()
    w.dual.delete()

    assert sorted(str(row) for row in RoleAssignment.objects.all()) == [
        "continuing · teacher · B028451:2024-2025",
        "inactive · secretariat · B047",
        "secretariat · secretariat · B047",
    ]
