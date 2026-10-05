"""Staff under a scope: who teaches an edition, who runs a programme's secretariat.

Separate from apps/catalog/views.py: those endpoints are about the catalogue
and its current editions, these about people. Members are nested under the
scope they belong to, as GitLab nests `/projects/:id/members` and Canvas
`/courses/:id/enrollments`, so the URL names the scope and the scope is
resolved, and checked, before anything else (apps/roles/api.py).

Who may grant a role is the assign table, `GRANT_PERMISSION` in
apps/roles/registry.py: holding its permission on the role's scope. A collection
view serves `POST` alone and a member view `DELETE` alone, so each view's
methods are exactly the keys of its `scope_map`, and any other method,
`OPTIONS` and `GET` included, is a 405. Members are read on the scope's own
row, an edition's `teachers` and a programme's `secretariat`
(apps/catalog/serializers.py): one read of the scope, and no second endpoint
answering the same question.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, cast

from django.http import Http404
from django.utils.translation import gettext_lazy as _
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.catalog.errors import StaffError
from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.catalog.serializers import StaffMemberSerializer
from apps.catalog.views import EditionView, ProgrammeView
from apps.roles.api import ScopedObjectView
from apps.roles.grants import AlreadyHeldError, grant, revoke
from apps.roles.models import RoleAssignment
from apps.roles.registry import GRANT_PERMISSION, Role

if TYPE_CHECKING:
    from django.db.models import QuerySet
    from rest_framework.request import Request

    from apps.accounts.models import User


class _Staff[M: (CourseEdition, DegreeProgramme)](ScopedObjectView[M]):
    """The rows that make someone `role` staff of the scope."""

    role: Role
    serializer_class = StaffMemberSerializer

    def rows(self) -> QuerySet[RoleAssignment]:
        on = (
            {"edition": self.scope}
            if isinstance(self.scope, CourseEdition)
            else {"programme": self.scope}
        )
        return RoleAssignment.objects.filter(role=self.role, **on).select_related("user")


class _StaffList[M: (CourseEdition, DegreeProgramme)](_Staff[M]):
    def post(self, request: Request, **kwargs: object) -> Response:
        serializer = StaffMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        try:
            grant(cast("User", request.user), user, self.role, self.scope)
        except AlreadyHeldError:
            raise ValidationError(
                {"username": [_("This user already holds this role here.")]},
                code=StaffError.ALREADY_HELD,
            ) from None
        return Response(StaffMemberSerializer(user).data, status=status.HTTP_201_CREATED)


class _StaffMember[M: (CourseEdition, DegreeProgramme)](_Staff[M]):
    def delete(self, request: Request, username: str, **kwargs: object) -> Response:
        row = self.rows().filter(user__username=username).first()
        if row is None or not revoke(cast("User", request.user), row):
            raise Http404
        return Response(status=status.HTTP_204_NO_CONTENT)


class EditionTeachersView(_StaffList[CourseEdition], EditionView):
    role = Role.TEACHER
    scope_map = MappingProxyType({"POST": GRANT_PERMISSION[Role.TEACHER]})


class EditionTeacherView(_StaffMember[CourseEdition], EditionView):
    role = Role.TEACHER
    scope_map = MappingProxyType({"DELETE": GRANT_PERMISSION[Role.TEACHER]})


class ProgrammeSecretariatView(_StaffList[DegreeProgramme], ProgrammeView):
    role = Role.SECRETARIAT
    scope_map = MappingProxyType({"POST": GRANT_PERMISSION[Role.SECRETARIAT]})


class ProgrammeSecretariatMemberView(_StaffMember[DegreeProgramme], ProgrammeView):
    role = Role.SECRETARIAT
    scope_map = MappingProxyType({"DELETE": GRANT_PERMISSION[Role.SECRETARIAT]})
