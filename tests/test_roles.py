"""Role rows and what they grant.

The rows: a role fits its scope, a grant is stored once, and it goes with its
scope. A refusal the database makes is asserted by the name of the constraint
PostgreSQL reports, as in tests/test_catalog_models.py. What they grant: one
`has_perm` truth table over every user, scope and permission, compared whole,
so a failure prints the cells that differ; and the lists of apps/roles/scopes.py
checked against it cell by cell. Last, the superuser enters a row in the admin,
where a misfit is a form error.

`world()` is the one set of people and scopes these tests share: every user is
created without a password, so none of them costs a password hash.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

import pytest
from django.contrib.auth.models import AnonymousUser
from django.db import IntegrityError, transaction
from django.urls import reverse
from test_catalog_models import violation

from apps.accounts.models import User
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.roles.models import RoleAssignment
from apps.roles.registry import EDITION_PERMISSIONS, PROGRAMME_PERMISSIONS, Role
from apps.roles.scopes import (
    editions_for,
    permissions_on,
    programmes_for,
    with_edition_roles,
    with_programme_roles,
)

if TYPE_CHECKING:
    from django.test import Client

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


def everyone(w: World) -> tuple[User, ...]:
    return (
        w.continuing,
        w.newcomer,
        w.secretariat,
        w.other_secretariat,
        w.dual,
        w.student,
        w.root,
        w.inactive,
    )


def label(scope: CourseEdition | DegreeProgramme) -> str:
    """A scope the way the command line spells it: CODE:YEAR, or a programme's code."""
    return str(scope) if isinstance(scope, CourseEdition) else scope.code


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


TEACHES = {"edition.view", "edition.set_current"}
RUNS_EDITION = {"edition.view", "edition.set_current", "edition.assign_teacher"}
RUNS_PROGRAMME = {"programme.view"}


def test_who_holds_what_where() -> None:
    w = world()
    cells = [(edition, EDITION_PERMISSIONS) for edition in (w.ppm_old, w.ppm_new, w.ia, w.shared)]
    cells += [(programme, PROGRAMME_PERMISSIONS) for programme in (w.b047, w.l031)]

    held = {
        (user.username, label(scope)): {p for p in permissions if user.has_perm(p, scope)}
        for user in everyone(w)
        for scope, permissions in cells
    }

    ppm_old, ppm_new = "B028451:2024-2025", "B028451:2025-2026"
    ia, shared, b047, l031 = "B003725:2025-2026", "B000001:2025-2026", "B047", "L031"
    expected = {(user.username, label(scope)): set() for user in everyone(w) for scope, _ in cells}
    expected |= {
        ("continuing", ppm_old): TEACHES,
        ("continuing", ppm_new): TEACHES,
        ("newcomer", ppm_new): TEACHES,
        # A programme's secretariat covers every edition of every course it
        # offers, the shared course included, and nothing of another programme.
        ("secretariat", ppm_old): RUNS_EDITION,
        ("secretariat", ppm_new): RUNS_EDITION,
        ("secretariat", shared): RUNS_EDITION,
        ("secretariat", b047): RUNS_PROGRAMME,
        ("other_secretariat", ia): RUNS_EDITION,
        ("other_secretariat", shared): RUNS_EDITION,
        ("other_secretariat", l031): RUNS_PROGRAMME,
        # Two roles add up, each on its own scope.
        ("dual", ia): TEACHES,
        ("dual", ppm_old): RUNS_EDITION,
        ("dual", ppm_new): RUNS_EDITION,
        ("dual", shared): RUNS_EDITION,
        ("dual", b047): RUNS_PROGRAMME,
        ("root", ppm_old): RUNS_EDITION,
        ("root", ppm_new): RUNS_EDITION,
        ("root", ia): RUNS_EDITION,
        ("root", shared): RUNS_EDITION,
        ("root", b047): {"programme.view", "programme.assign_secretariat"},
        ("root", l031): {"programme.view", "programme.assign_secretariat"},
    }
    assert held == expected

    # Past the table: a permission asked of the wrong kind of scope, of no
    # scope, or by a name the registry does not have. The superuser's yes is
    # Django's: `User.has_perm` answers an active superuser before any backend.
    edge = {
        "programme permission on an edition": w.secretariat.has_perm("programme.view", w.ppm_new),
        "edition permission on a programme": w.secretariat.has_perm("edition.view", w.b047),
        "no scope": w.secretariat.has_perm("edition.view"),
        "unknown permission": w.secretariat.has_perm("edition.delete", w.ppm_new),
        "superuser, no scope": w.root.has_perm("edition.view"),
        "superuser, unknown permission": w.root.has_perm("edition.delete", w.ppm_new),
    }
    assert edge == {
        "programme permission on an edition": False,
        "edition permission on a programme": False,
        "no scope": False,
        "unknown permission": False,
        "superuser, no scope": True,
        "superuser, unknown permission": True,
    }


def test_lists_and_permissions_agree_with_has_perm() -> None:
    w = world()
    editions = list(CourseEdition.objects.all())
    programmes = list(DegreeProgramme.objects.all())

    for user in everyone(w):
        # What has_perm answers, asked once per cell; the lists and the
        # per-row permissions must say the same.
        on_edition = {
            e.pk: {p for p in EDITION_PERMISSIONS if user.has_perm(p, e)} for e in editions
        }
        on_programme = {
            g.pk: {p for p in PROGRAMME_PERMISSIONS if user.has_perm(p, g)} for g in programmes
        }
        for p in EDITION_PERMISSIONS:
            listed = sorted(e.pk for e in editions_for(user, p))
            assert listed == sorted(pk for pk, held in on_edition.items() if p in held), (user, p)
        for p in PROGRAMME_PERMISSIONS:
            listed = sorted(g.pk for g in programmes_for(user, p))
            assert listed == sorted(pk for pk, held in on_programme.items() if p in held), (user, p)
        for edition in with_edition_roles(CourseEdition.objects.all(), user):
            assert permissions_on(user, edition) == on_edition[edition.pk], (user, edition)
        for programme in with_programme_roles(DegreeProgramme.objects.all(), user):
            assert permissions_on(user, programme) == on_programme[programme.pk], (user, programme)

    for p in EDITION_PERMISSIONS:
        assert not editions_for(AnonymousUser(), p).exists()
    for p in PROGRAMME_PERMISSIONS:
        assert not programmes_for(AnonymousUser(), p).exists()


def test_the_admin_enters_a_role_and_refuses_a_misfit(client: Client) -> None:
    w = world()
    client.force_login(w.root)
    add = reverse("admin:roles_roleassignment_add")

    fits = client.post(add, {"user": w.student.pk, "role": "teacher", "edition": w.ppm_new.pk})
    misfit = client.post(add, {"user": w.student.pk, "role": "teacher", "programme": w.b047.pk})

    assert fits.status_code == 302
    assert misfit.status_code == 200
    assert "A teacher is assigned to an edition, secretariat staff to a programme." in (
        misfit.content.decode()
    )
    assert [str(row) for row in RoleAssignment.objects.filter(user=w.student)] == [
        "student · teacher · B028451:2025-2026"
    ]
