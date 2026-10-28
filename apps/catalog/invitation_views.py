"""Invitations under a scope: made, listed and revoked by whoever may grant the role there.

Nested and checked as the staff are (apps/catalog/staff_views.py): an
edition's invitations make teachers and a programme's secretariat staff, and
every method needs the permission that grants that role (`GRANT_PERMISSION`,
apps/roles/registry.py). A list holds the scope's invitations not accepted
yet, the expired ones too, oldest first; the superuser also reads every
scope's at once. What making, revoking and accepting do is
apps/roles/invitations.py.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, cast

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsSuperuser
from apps.catalog.invitation_serializers import InvitationSerializer, NewInvitationSerializer
from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.catalog.views import EditionView, ProgrammeView
from apps.roles.api import ScopedObjectView
from apps.roles.invitations import invite, revoke_invitation
from apps.roles.models import Invitation, on_scope
from apps.roles.registry import GRANT_PERMISSION, Role
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from django.db.models import QuerySet
    from rest_framework.request import Request

    from apps.accounts.models import User


def _listed(invitations: QuerySet[Invitation]) -> QuerySet[Invitation]:
    """`invitations` with what their serializer names, in one query."""
    return invitations.select_related("created_by", "edition__course", "programme")


class _Invitations[M: (CourseEdition, DegreeProgramme)](ScopedObjectView[M]):
    """The invitations that would make someone `role` staff of the scope."""

    role: Role

    def rows(self) -> QuerySet[Invitation]:
        return _listed(Invitation.objects.filter(role=self.role, **on_scope(self.scope)))


class _InvitationList[M: (CourseEdition, DegreeProgramme)](_Invitations[M]):
    def get(self, request: Request, **kwargs: object) -> Response:
        return Response(InvitationSerializer(self.rows(), many=True).data)

    def post(self, request: Request, **kwargs: object) -> Response:
        # Past IsAuthenticated, so this project's user; the cast is the one
        # `session_body` explains (apps/accounts/views.py).
        invitation, token = invite(cast("User", request.user), self.role, self.scope, request)
        body = NewInvitationSerializer(invitation, context={"token": token}).data
        return Response(body, status=status.HTTP_201_CREATED)


class _InvitationMember[M: (CourseEdition, DegreeProgramme)](_Invitations[M]):
    def delete(self, request: Request, invitation: int, **kwargs: object) -> Response:
        row = self.rows().filter(pk=invitation).first()
        if row is None or not revoke_invitation(cast("User", request.user), row, request):
            fail(ErrorCode.NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


TEACHER_GRANT = GRANT_PERMISSION[Role.TEACHER]
SECRETARIAT_GRANT = GRANT_PERMISSION[Role.SECRETARIAT]


class EditionInvitationsView(_InvitationList[CourseEdition], EditionView):
    role = Role.TEACHER
    scope_map = MappingProxyType({"GET": TEACHER_GRANT, "POST": TEACHER_GRANT})


class EditionInvitationView(_InvitationMember[CourseEdition], EditionView):
    role = Role.TEACHER
    scope_map = MappingProxyType({"DELETE": TEACHER_GRANT})


class ProgrammeInvitationsView(_InvitationList[DegreeProgramme], ProgrammeView):
    role = Role.SECRETARIAT
    scope_map = MappingProxyType({"GET": SECRETARIAT_GRANT, "POST": SECRETARIAT_GRANT})


class ProgrammeInvitationView(_InvitationMember[DegreeProgramme], ProgrammeView):
    role = Role.SECRETARIAT
    scope_map = MappingProxyType({"DELETE": SECRETARIAT_GRANT})


class InvitationListView(ListAPIView[Invitation]):
    """`GET`: every scope's invitations, for the superuser; each is revoked under its scope."""

    permission_classes = (IsAuthenticated, IsSuperuser)
    serializer_class = InvitationSerializer

    def get_queryset(self) -> QuerySet[Invitation]:
        return _listed(Invitation.objects.all())
