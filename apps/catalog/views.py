"""The catalogue API: what the caller's roles cover, and switching a current edition.

A list holds the scopes the caller may view, each with the permissions the
caller holds on it (apps/catalog/serializers.py); a student with no role gets
an empty list. A view on one edition answers 404 for an edition outside the
caller's scope and 403 for one inside it without the permission, in that
order, by construction (apps/roles/api.py). What each role may do is the
registry's (apps/roles/registry.py); no view here names a role.

Switching checks both ends. A teacher row outlives its academic year, and the
switch moves the whole course's default, so `edition.set_current` on the new
edition alone would let last year's teacher move the course back to their
year. The switch also asks it of the edition being replaced, inside
`set_current()`'s lock (docs/decisions.md, 2026-09-29, *Staff permissions are
a registry in code, answered by one backend; the admin is the superuser's*,
point 4).
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, cast

from django.http import Http404
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.catalog.editions import set_current
from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.catalog.serializers import EditionSerializer, ProgrammeSerializer
from apps.roles.api import ScopedObjectView
from apps.roles.registry import Permission
from apps.roles.scopes import editions_for, programmes_for

if TYPE_CHECKING:
    from django.db.models import QuerySet
    from rest_framework.request import Request

    from apps.accounts.models import User

# Each view below filters by its `visible_with`, and
# tests/test_route_permissions.py collects the attribute to check that every
# permission guards a route: the attribute that filters is the one it reads.


class ProgrammeListView(ListAPIView[DegreeProgramme]):
    permission_classes = (IsAuthenticated,)
    serializer_class = ProgrammeSerializer
    visible_with = Permission.PROGRAMME_VIEW

    def get_queryset(self) -> QuerySet[DegreeProgramme]:
        return programmes_for(self.request.user, self.visible_with)


class EditionListView(ListAPIView[CourseEdition]):
    permission_classes = (IsAuthenticated,)
    serializer_class = EditionSerializer
    visible_with = Permission.EDITION_VIEW

    def get_queryset(self) -> QuerySet[CourseEdition]:
        return editions_for(self.request.user, self.visible_with).select_related("course")


class EditionView(ScopedObjectView[CourseEdition]):
    """A view on one edition: the editions the caller may view are the only ones there are."""

    serializer_class = EditionSerializer
    visible_with = Permission.EDITION_VIEW

    def get_queryset(self) -> QuerySet[CourseEdition]:
        return editions_for(self.request.user, self.visible_with).select_related("course")


class ProgrammeView(ScopedObjectView[DegreeProgramme]):
    """A view on one programme, named in the URL by its code."""

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
        # Read again: the row changed, and its marks come with the query.
        return Response(self.get_serializer(self.get_object()).data)
