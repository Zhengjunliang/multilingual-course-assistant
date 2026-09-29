"""The catalogue as the API shows it: read-only, each scope with what the caller holds on it.

`permissions` is how the SPA knows which buttons to offer, without working
anything out from role names: it is `permissions_on()` (apps/roles/scopes.py)
read from the marks the list query already put on each row, so a list costs
the same number of queries however long it is. The rows must come from
`editions_for` / `programmes_for`; a row read any other way has no marks, and
the serializer fails on it rather than reporting an empty set.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.catalog.models import Course, CourseEdition, DegreeProgramme
from apps.roles.scopes import permissions_on


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


class EditionSerializer(serializers.ModelSerializer[CourseEdition]):
    course = CourseSerializer(read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CourseEdition
        fields = ("id", "course", "academic_year", "is_current", "permissions")
        read_only_fields = fields

    def get_permissions(self, edition: CourseEdition) -> list[str]:
        return sorted(permissions_on(self.context["request"].user, edition))
