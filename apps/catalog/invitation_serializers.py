"""An invitation as the API shows it: on a list, just made, and opened by its holder.

Only the answer that makes an invitation holds its token
(`NewInvitationSerializer`): a list is read by whoever may grant the role
there, and the token is the holder's credential (apps/roles/invitations.py).
The scope is named as a page shows it, a course's name and year or a
programme's name, so neither the holder, who may see no catalogue, nor the
superuser reading every scope's invitations at once looks it up elsewhere.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.catalog.models import Course, CourseEdition
from apps.catalog.serializers import ProgrammeNameSerializer
from apps.roles.models import Invitation


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on each `Meta`.
class CourseNameSerializer(serializers.ModelSerializer[Course]):
    """A course as an invitation names it: no entries."""

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Course
        fields = ("code", "name", "locale")
        read_only_fields = fields


class EditionNameSerializer(serializers.ModelSerializer[CourseEdition]):
    """An edition as an invitation names it: its course and its year."""

    course = CourseNameSerializer(read_only=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CourseEdition
        fields = ("id", "course", "academic_year")
        read_only_fields = fields


class InvitationSerializer(serializers.ModelSerializer[Invitation]):
    """A row of a scope's invitations, or of every scope's.

    `edition` is null on a secretariat invitation and `programme` on a
    teacher's (apps/roles/models.py). Past `expires_at` the invitation no
    longer works, and stays listed until revoked.
    """

    edition = EditionNameSerializer(read_only=True)
    programme = ProgrammeNameSerializer(read_only=True)
    created_by = serializers.SlugRelatedField(slug_field="username", read_only=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Invitation
        fields = ("id", "role", "edition", "programme", "created_by", "created_at", "expires_at")
        read_only_fields = fields


class NewInvitationSerializer(InvitationSerializer):
    """An invitation just made: its row, and the one time its token is shown."""

    token = serializers.SerializerMethodField()

    class Meta(InvitationSerializer.Meta):  # pyright: ignore[reportIncompatibleVariableOverride]
        fields = (*InvitationSerializer.Meta.fields, "token")
        read_only_fields = fields

    def get_token(self, invitation: Invitation) -> str:
        return self.context["token"]


class InvitationGrantSerializer(InvitationSerializer):
    """What an invitation makes its holder, for the page it is opened on."""

    class Meta(InvitationSerializer.Meta):  # pyright: ignore[reportIncompatibleVariableOverride]
        fields = ("role", "edition", "programme")
        read_only_fields = fields
