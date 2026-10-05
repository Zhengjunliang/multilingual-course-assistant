"""The catalogue as the API shows it, and the staff members of a scope.

The catalogue is read-only here, each scope with what the caller holds on it;
its rows are entered in the admin.

`permissions` is how the SPA knows which buttons to offer, without working
anything out from role names: it is `permissions_on()` (apps/roles/scopes.py)
read from the marks the list query already put on each row, so a list costs
the same number of queries however long it is. An edition also says whether
the caller may make it current, `can_set_current()` read from the same kind of
mark, and who teaches it, from rows the list query prefetched. A programme
carries its curricula, its course count and its secretariat, and a course
every curriculum entry of every programme, from prefetched rows too. The rows
must come from the catalogue views' querysets (apps/catalog/views.py); a row
read any other way has no marks or prefetched rows, and the serializer fails
on it rather than reporting an empty set.

Which programmes list a course is the public study plan, so a course names
them all, to whoever may read the course; the staff of each programme are
shown only on the programme, which keeps its own scope.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.accounts.models import User
from apps.catalog.errors import StaffError
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.roles.scopes import can_set_current, permissions_on

if TYPE_CHECKING:
    from apps.roles.models import RoleAssignment

# Where the catalogue views' querysets put prefetched rows (apps/catalog/views.py):
# an edition's teacher rows, a programme's secretariat rows, a course's or a
# programme's curriculum entries, and a course's current edition.
TEACHER_ROWS = "teacher_rows"
SECRETARIAT_ROWS = "secretariat_rows"
ENTRY_ROWS = "entry_rows"
CURRENT_EDITIONS = "current_editions"


def _members(rows: list[RoleAssignment]) -> list[dict[str, Any]]:
    users = [row.user for row in rows]
    # A list at run time: the stubs type `.data` as a dict whatever `many` says.
    return cast("list[dict[str, Any]]", StaffMemberSerializer(users, many=True).data)


# `ModelSerializer[...]` for the reason apps/accounts/serializers.py gives, and
# the same suppression on each `Meta`.
class ProgrammeNameSerializer(serializers.ModelSerializer[DegreeProgramme]):
    """A programme as a curriculum entry names it: no staff, no permissions."""

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = DegreeProgramme
        fields = ("code", "name", "locale")
        read_only_fields = fields


class CurriculumEntrySerializer(serializers.ModelSerializer[CurriculumEntry]):
    programme = ProgrammeNameSerializer(read_only=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CurriculumEntry
        fields = ("programme", "curriculum", "year_of_study", "ad_code")
        read_only_fields = fields


class CourseSerializer(serializers.ModelSerializer[Course]):
    entries = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Course
        fields = ("code", "name", "locale", "code_source", "entries")
        read_only_fields = fields

    def get_entries(self, course: Course) -> list[dict[str, Any]]:
        rows = getattr(course, ENTRY_ROWS)
        return cast("list[dict[str, Any]]", CurriculumEntrySerializer(rows, many=True).data)


class ProgrammeSerializer(serializers.ModelSerializer[DegreeProgramme]):
    curricula = serializers.SerializerMethodField()
    course_count = serializers.SerializerMethodField()
    secretariat = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = DegreeProgramme
        fields = (
            "code",
            "name",
            "locale",
            "curricula",
            "course_count",
            "secretariat",
            "permissions",
        )
        read_only_fields = fields

    def get_curricula(self, programme: DegreeProgramme) -> list[str]:
        # The empty string is "no curriculum" (apps/catalog/models.py), not a name.
        return sorted({row.curriculum for row in getattr(programme, ENTRY_ROWS) if row.curriculum})

    def get_course_count(self, programme: DegreeProgramme) -> int:
        # A course two curricula list is two entries and one course.
        return len({row.course_id for row in getattr(programme, ENTRY_ROWS)})

    def get_secretariat(self, programme: DegreeProgramme) -> list[dict[str, Any]]:
        return _members(getattr(programme, SECRETARIAT_ROWS))

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
            raise serializers.ValidationError(
                {"username": [_("No such user.")]}, code=StaffError.NO_SUCH_USER
            ) from None
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
        return _members(getattr(edition, TEACHER_ROWS))

    def get_permissions(self, edition: CourseEdition) -> list[str]:
        return sorted(permissions_on(self.context["request"].user, edition))

    def get_can_set_current(self, edition: CourseEdition) -> bool:
        return can_set_current(self.context["request"].user, edition)


class EditionSummarySerializer(serializers.ModelSerializer[CourseEdition]):
    """An edition as a study plan row shows it: its year and who teaches it."""

    teachers = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = CourseEdition
        fields = ("id", "academic_year", "teachers")
        read_only_fields = fields

    def get_teachers(self, edition: CourseEdition) -> list[dict[str, Any]]:
        return _members(getattr(edition, TEACHER_ROWS))


class StudyPlanCourseSerializer(serializers.Serializer):
    """A row of a programme's study plan: a course, and its current edition when it has one.

    The course is nested whole rather than its fields spread beside the
    edition's, so a row is the course's own shape plus one field, and the
    SPA's mirror composes the two types instead of extending one.
    """

    course = CourseSerializer(source="*", read_only=True)
    current_edition = serializers.SerializerMethodField()

    def get_current_edition(self, course: Course) -> dict[str, Any] | None:
        current = getattr(course, CURRENT_EDITIONS)
        return EditionSummarySerializer(current[0]).data if current else None
