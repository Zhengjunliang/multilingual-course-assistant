"""The catalogue as the API shows it, and the staff members of a scope.

The catalogue is read-only here, each scope with what the caller holds on it;
its rows are entered in the admin.

`permissions` is how the SPA knows which buttons to offer, without working
anything out from role names: it is `permissions_on()` (apps/roles/scopes.py)
read from the marks the list query already put on each row, so a list costs
the same number of queries however long it is. An edition also says whether
the caller may make it current, `can_set_current()` read from the same kind of
mark, and who teaches it, from rows the list query prefetched. The rows must
come from the catalogue views' querysets (apps/catalog/views.py); a row read
any other way has no marks, and the serializer fails on it rather than
reporting an empty set.
"""

from __future__ import annotations

from typing import Any, cast

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.accounts.models import User
from apps.catalog.models import Course, CourseEdition, DegreeProgramme
from apps.roles.scopes import can_set_current, permissions_on

# Where the catalogue views' edition queryset puts each edition's teacher rows
# (apps/catalog/views.py).
TEACHER_ROWS = "teacher_rows"


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on each `Meta`.
class CourseSerializer(serializers.ModelSerializer[Course]):
    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Course
        fields = ("code", "name", "locale")
        read_only_fields = fields


class ProgrammeSerializer(serializers.ModelSerializer[DegreeProgramme]):
    permissions = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = DegreeProgramme
        fields = ("code", "name", "locale", "permissions")
        read_only_fields = fields

    def get_permissions(self, programme: DegreeProgramme) -> list[str]:
        return sorted(permissions_on(self.context["request"].user, programme))


class StaffMemberSerializer(serializers.Serializer):
    """A member of a scope's staff: shown by id and username, and named by username to add one.

    A plain serializer, not a `ModelSerializer[User]`: that would validate the
    username as a new, unique one, and refuse every user who exists.
    """

    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(max_length=150)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        try:
            attrs["user"] = User.objects.get(username=attrs["username"])
        except User.DoesNotExist:
            raise serializers.ValidationError({"username": [_("No such user.")]}) from None
        return attrs


class EditionSerializer(serializers.ModelSerializer[CourseEdition]):
    course = CourseSerializer(read_only=True)
    teachers = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    can_set_current = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CourseEdition
        fields = (
            "id",
            "course",
            "academic_year",
            "is_current",
            "teachers",
            "permissions",
            "can_set_current",
        )
        read_only_fields = fields

    def get_teachers(self, edition: CourseEdition) -> list[dict[str, Any]]:
        users = [row.user for row in getattr(edition, TEACHER_ROWS)]
        # A list at run time: the stubs type `.data` as a dict whatever `many` says.
        return cast("list[dict[str, Any]]", StaffMemberSerializer(users, many=True).data)

    def get_permissions(self, edition: CourseEdition) -> list[str]:
        return sorted(permissions_on(self.context["request"].user, edition))

    def get_can_set_current(self, edition: CourseEdition) -> bool:
        return can_set_current(self.context["request"].user, edition)
