"""The catalogue API: what the caller's roles cover, and switching a current edition.

A list holds the scopes the caller may view, each with the permissions the
caller holds on it (apps/catalog/serializers.py); a student with no role gets
an empty list. The edition list narrows to one course with `?course=`. A
view on one scope — reading it, or acting on it — answers 404 for a scope
outside the caller's reach and 403 for one inside it without the permission,
in that order, by construction (apps/roles/api.py). What each role may do is
the registry's (apps/roles/registry.py); no view here names a role.

A programme's study plan lists each course once, with or without an edition,
and a course is read by whoever views a programme that lists it
(`courses_for()`, apps/roles/scopes.py). Each list and each read of one row
goes through one queryset function below, so its cost does not grow with the
rows it holds.

Switching checks both ends. A teacher row outlives its academic year, and the
switch moves the whole course's default, so `edition.set_current` on the new
edition alone would let last year's teacher move the course back to their
year. The switch also asks it of the edition being replaced, inside
`set_current()`'s lock (docs/decisions.md, 2026-09-29, *Staff permissions are
a registry in code, answered by one backend; the admin is the superuser's*,
point 4), and a refusal there carries its own code.

Every view here names each refusal with a code (`CodedErrors`,
config/exceptions.py; the codes: apps/catalog/errors.py).
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, cast

from django.core.exceptions import PermissionDenied
from django.db.models import Exists, OuterRef, Prefetch
from django.http import Http404
from rest_framework import exceptions
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.catalog.editions import SWITCH_NEEDS_BOTH, set_current
from apps.catalog.errors import StaffError
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.catalog.serializers import (
    CURRENT_EDITIONS,
    ENTRY_ROWS,
    SECRETARIAT_ROWS,
    TEACHER_ROWS,
    CourseSerializer,
    EditionSerializer,
    ProgrammeSerializer,
    StudyPlanCourseSerializer,
)
from apps.roles.api import ScopedObjectView
from apps.roles.models import RoleAssignment
from apps.roles.registry import Permission, Role
from apps.roles.scopes import courses_for, editions_for, programmes_for, with_switch
from config.exceptions import CodedErrors

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from django.contrib.auth.models import AnonymousUser
    from django.db.models import QuerySet
    from rest_framework.request import Request

    from apps.accounts.models import User

# Each view below filters by its `visible_with`, and
# tests/test_route_permissions.py collects the attribute to check that every
# permission guards a route: the attribute that filters is the one it reads.


def _staff(role: Role, to_attr: str) -> Prefetch[str, QuerySet[RoleAssignment], str]:
    """The `role` rows of each scope, with their users, by username."""
    rows = (
        RoleAssignment.objects.filter(role=role).select_related("user").order_by("user__username")
    )
    return Prefetch("role_assignments", queryset=rows, to_attr=to_attr)


def _entries(lookup: str) -> Prefetch[str, QuerySet[CurriculumEntry], str]:
    """Each course's entries in every programme's study plan, through `lookup`."""
    rows = CurriculumEntry.objects.select_related("programme").order_by(
        "programme__code", "curriculum", "year_of_study"
    )
    return Prefetch(lookup, queryset=rows, to_attr=ENTRY_ROWS)


def _editions(
    user: AbstractBaseUser | AnonymousUser, permission: Permission
) -> QuerySet[CourseEdition]:
    """The editions on which `user` holds `permission`, with everything their serializer reads.

    One queryset for the list, the read of one edition and the answer to a
    switch, so none of the three serves a row without its marks. The teachers
    and the course's entries come in one prefetch query each, however many
    editions there are.
    """
    return (
        with_switch(editions_for(user, permission), user)
        .select_related("course")
        .prefetch_related(
            _staff(Role.TEACHER, TEACHER_ROWS), _entries("course__curriculum_entries")
        )
    )


def _programmes(
    user: AbstractBaseUser | AnonymousUser, permission: Permission
) -> QuerySet[DegreeProgramme]:
    """The programmes on which `user` holds `permission`, with their entries and secretariat.

    The entries are read for the curricula and the course count alone, so
    only the three columns those need.
    """
    entries = CurriculumEntry.objects.only("programme", "curriculum", "course")
    return programmes_for(user, permission).prefetch_related(
        Prefetch("curriculum_entries", queryset=entries, to_attr=ENTRY_ROWS),
        _staff(Role.SECRETARIAT, SECRETARIAT_ROWS),
    )


class ProgrammeListView(CodedErrors, ListAPIView[DegreeProgramme]):
    permission_classes = (IsAuthenticated,)
    serializer_class = ProgrammeSerializer
    visible_with = Permission.PROGRAMME_VIEW

    def get_queryset(self) -> QuerySet[DegreeProgramme]:
        return _programmes(self.request.user, self.visible_with)


class EditionListView(CodedErrors, ListAPIView[CourseEdition]):
    permission_classes = (IsAuthenticated,)
    serializer_class = EditionSerializer
    visible_with = Permission.EDITION_VIEW

    def get_queryset(self) -> QuerySet[CourseEdition]:
        editions = _editions(self.request.user, self.visible_with)
        # A course the caller may not view narrows to nothing, as an unknown one
        # does. So does a value no code can be (apps/catalog/models.py), checked
        # here because PostgreSQL refuses a NUL byte with an error.
        course = self.request.query_params.get("course")
        if course is not None:
            known = course.isascii() and course.isalnum()
            editions = editions.filter(course__code=course) if known else editions.none()
        return editions


class EditionView(ScopedObjectView[CourseEdition]):
    """A view on one edition: the editions the caller may view are the only ones there are.

    It serves no method itself: each subclass serves exactly the methods its
    `scope_map` names (tests/test_route_permissions.py), so a handler here
    would reach every view on an edition.
    """

    serializer_class = EditionSerializer
    visible_with = Permission.EDITION_VIEW

    def get_queryset(self) -> QuerySet[CourseEdition]:
        return _editions(self.request.user, self.visible_with)


class ProgrammeView(ScopedObjectView[DegreeProgramme]):
    """A view on one programme, named in the URL by its code; like `EditionView`, it serves
    no method itself."""

    lookup_field = "code"
    visible_with = Permission.PROGRAMME_VIEW

    def get_queryset(self) -> QuerySet[DegreeProgramme]:
        return programmes_for(self.request.user, self.visible_with)


class EditionSetCurrentView(EditionView):
    """`POST` makes the edition its course's current one and answers with the edition."""

    scope_map = MappingProxyType({"POST": Permission.EDITION_SET_CURRENT})

    def post(self, request: Request, pk: int) -> Response:
        user = cast("User", request.user)
        try:
            set_current(
                self.scope,
                may_replace=lambda replaced: user.has_perm(
                    Permission.EDITION_SET_CURRENT, replaced
                ),
            )
        except CourseEdition.DoesNotExist as exc:
            raise Http404 from exc
        except PermissionDenied:
            raise exceptions.PermissionDenied(
                SWITCH_NEEDS_BOTH, code=StaffError.SWITCH_NEEDS_BOTH
            ) from None
        # Read again: the row changed, and its marks come with the query.
        return Response(self.get_serializer(self.get_object()).data)


class EditionDetailView(EditionView):
    """`GET` reads one edition, as the list shows it."""

    scope_map = MappingProxyType({"GET": Permission.EDITION_VIEW})

    def get(self, request: Request, pk: int) -> Response:
        return Response(self.get_serializer(self.scope).data)


class ProgrammeDetailView(ProgrammeView):
    """`GET` reads one programme, as the list shows it."""

    serializer_class = ProgrammeSerializer
    scope_map = MappingProxyType({"GET": Permission.PROGRAMME_VIEW})

    def get_queryset(self) -> QuerySet[DegreeProgramme]:
        return _programmes(self.request.user, self.visible_with)

    def get(self, request: Request, code: str) -> Response:
        return Response(self.get_serializer(self.scope).data)


class ProgrammeCoursesView(ProgrammeView):
    """`GET` lists the programme's study plan: each course it lists, once, by code.

    A course two curricula list is one row with both entries, and a course
    with no edition yet is a row too, with no current edition. The current
    edition is one the caller may view, which is every edition of the course
    for whoever may view the programme.
    """

    scope_map = MappingProxyType({"GET": Permission.PROGRAMME_VIEW})

    def get(self, request: Request, code: str) -> Response:
        # `Exists`, not a join through the entries: a course in two curricula stays one row.
        listed = CurriculumEntry.objects.filter(course=OuterRef("pk"), programme=self.scope)
        current = (
            editions_for(request.user, Permission.EDITION_VIEW)
            .filter(is_current=True)
            .prefetch_related(_staff(Role.TEACHER, TEACHER_ROWS))
        )
        courses = Course.objects.filter(Exists(listed)).prefetch_related(
            _entries("curriculum_entries"),
            Prefetch("editions", queryset=current, to_attr=CURRENT_EDITIONS),
        )
        return Response(StudyPlanCourseSerializer(courses, many=True).data)


class CourseDetailView(CodedErrors, RetrieveAPIView[Course]):
    """`GET` reads one course, named by its code, with its entries in every programme.

    Not a `ScopedObjectView`: a course is no scope of the registry, so there
    is nothing to hold on it, only whether the caller may see it. A course
    outside that is a 404, as missing as a code that names none, and there is
    no 403 because there is no write. No OPTIONS, for the reason
    apps/roles/api.py gives.
    """

    permission_classes = (IsAuthenticated,)
    serializer_class = CourseSerializer
    lookup_field = "code"
    visible_with = Permission.PROGRAMME_VIEW
    http_method_names = ("get", "head")  # pyright: ignore[reportIncompatibleVariableOverride]

    def get_queryset(self) -> QuerySet[Course]:
        return courses_for(self.request.user, self.visible_with).prefetch_related(
            _entries("curriculum_entries")
        )
