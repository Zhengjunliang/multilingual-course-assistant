"""The course list a conversation adds editions from, as `GET /api/scope` shows it.

Read only: what a conversation adds travels with its questions
(`AskRequest.added_editions`, apps/qa/serializers.py), which checks it against
the boundary again, so nothing here grants anything. `frontend/src/api/scope.ts`
mirrors these shapes, and tests/test_scope_contract.py keeps the two in step.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from rest_framework import serializers

from apps.catalog.models import CourseEdition
from apps.qa.scope import is_default, state

if TYPE_CHECKING:
    from apps.catalog.models import Course


@dataclass(frozen=True)
class ListedCourse:
    """A course of the caller's boundary (apps/qa/scope.py), and its editions there."""

    course: Course
    # Its earliest year in the caller's declared programme; None for a course
    # only a role brings.
    year_of_study: int | None
    editions: list[CourseEdition]


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on `Meta`.
class ScopeEditionSerializer(serializers.ModelSerializer[CourseEdition]):
    """An edition of the boundary: where it stands, and whether a question
    searches it without its conversation adding it."""

    state = serializers.SerializerMethodField()
    # Not `get_default`, the name DRF gives every field's own default.
    default = serializers.SerializerMethodField(method_name="searched_unadded")

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CourseEdition
        fields = ("id", "academic_year", "state", "default")
        read_only_fields = fields

    def get_state(self, edition: CourseEdition) -> str:
        return state(edition)

    def searched_unadded(self, edition: CourseEdition) -> bool:
        return is_default(edition)


class ScopeCourseSerializer(serializers.Serializer):
    """A course as the composer lists it: named as the catalogue names it, its
    editions newest first."""

    code = serializers.CharField(source="course.code", read_only=True)
    name = serializers.CharField(source="course.name", read_only=True)
    # The language `name` is written in.
    locale = serializers.CharField(source="course.locale", read_only=True)
    year_of_study = serializers.IntegerField(read_only=True, allow_null=True)
    editions = ScopeEditionSerializer(many=True, read_only=True)
