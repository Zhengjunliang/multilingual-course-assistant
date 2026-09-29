"""The catalogue API: what the caller's roles cover, and switching a current edition.

A list holds the scopes the caller may view, each with the permissions the
caller holds on it (apps/catalog/serializers.py); a student with no role gets
an empty list. The edition list narrows to one programme with `?programme=`.
A view on one scope — reading it, or acting on it — answers 404 for a scope
outside the caller's reach and 403 for one inside it without the permission,
in that order, by construction (apps/roles/api.py). What each role may do is
the registry's (apps/roles/registry.py); no view here names a role.

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
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.catalog.editions import SWITCH_NEEDS_BOTH, set_current
from apps.catalog.errors import StaffError
from apps.catalog.models import CourseEdition, CurriculumEntry, DegreeProgramme
from apps.catalog.serializers import TEACHER_ROWS, EditionSerializer, ProgrammeSerializer
from apps.roles.api import ScopedObjectView
from apps.roles.models import RoleAssignment
from apps.roles.registry import Permission, Role
from apps.roles.scopes import editions_for, programmes_for, with_switch
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


def _editions(
    user: AbstractBaseUser | AnonymousUser, permission: Permission
) -> QuerySet[CourseEdition]:
    """The editions on which `user` holds `permission`, with everything their serializer reads.

    One queryset for the list, the read of one edition and the answer to a
    switch, so none of the three serves a row without its marks. The teachers
    come in one prefetch query however many editions there are.
    """
    teachers = (
        RoleAssignment.objects.filter(role=Role.TEACHER)
        .select_related("user")
        .order_by("user__username")
    )
    return (
        with_switch(editions_for(user, permission), user)
        .select_related("course")
        .prefetch_related(Prefetch("role_assignments", queryset=teachers, to_attr=TEACHER_ROWS))
    )


class ProgrammeListView(CodedErrors, ListAPIView[DegreeProgramme]):
    permission_classes = (IsAuthenticated,)
    serializer_class = ProgrammeSerializer
    visible_with = Permission.PROGRAMME_VIEW

    def get_queryset(self) -> QuerySet[DegreeProgramme]:
        return programmes_for(self.request.user, self.visible_with)


class EditionListView(CodedErrors, ListAPIView[CourseEdition]):
    permission_classes = (IsAuthenticated,)
    serializer_class = EditionSerializer
    visible_with = Permission.EDITION_VIEW

    def get_queryset(self) -> QuerySet[CourseEdition]:
        editions = _editions(self.request.user, self.visible_with)
        code = self.request.query_params.get("programme")
        if code is None:
            return editions
        # `Exists`, not a join: a course a programme offers in two curricula
        # stays one row. A code the caller may not view narrows to nothing, as
        # an unknown one does, so the list never tells the two apart.
        offered = CurriculumEntry.objects.filter(
            course=OuterRef("course"),
            programme__in=programmes_for(self.request.user, Permission.PROGRAMME_VIEW).filter(
                code=code
            ),
        )
        return editions.filter(Exists(offered))


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

    def get(self, request: Request, code: str) -> Response:
        return Response(self.get_serializer(self.scope).data)
