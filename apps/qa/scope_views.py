"""The courses a signed-in caller's questions may search, for the composer to add from (#36).

Separate from apps/qa/views.py, whose rules are the stream's, and from
apps/qa/conversation_views.py, whose rows the caller owns: this one reads the
catalogue through the boundary of apps/qa/scope.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from django.db.models import OuterRef, Subquery
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProgramme
from apps.catalog.models import CurriculumEntry
from apps.qa.scope import boundary
from apps.qa.scope_serializers import ListedCourse, ScopeCourseSerializer

if TYPE_CHECKING:
    from rest_framework.request import Request

    from apps.accounts.models import User

# The mark `listed` puts on an edition: its course's earliest year in the
# caller's programme.
_YEAR = "programme_year"


def listed(user: User) -> list[ListedCourse]:
    """Every course of `user`'s boundary with its editions there, newest first.

    Their own year first, then the programme's other years in order, then the
    courses a role alone brings; by name within each. Without a declared year
    the courses are the same, in the programme's order. Two queries: the
    boundary, carrying each course's year, and the year the account declared.
    """
    years = CurriculumEntry.objects.filter(
        course=OuterRef("course"),
        programme__in=StudentProgramme.objects.filter(user=user).values("programme"),
    ).order_by("year_of_study")
    editions = boundary(user).annotate(**{_YEAR: Subquery(years.values("year_of_study")[:1])})
    courses: dict[int, ListedCourse] = {}
    for edition in editions.order_by("-academic_year"):
        course = courses.setdefault(
            edition.course.pk, ListedCourse(edition.course, getattr(edition, _YEAR), [])
        )
        course.editions.append(edition)

    own = StudentProgramme.objects.filter(user=user).values_list("year_of_study", flat=True).first()

    def place(course: ListedCourse) -> tuple[bool, bool, int, str, str]:
        year = course.year_of_study
        return (
            year is None or year != own,
            year is None,
            year or 0,
            course.course.name.casefold(),
            course.course.code,
        )

    return sorted(courses.values(), key=place)


class ScopeView(APIView):
    """`GET`: the course list, each edition marked with where it stands and
    whether a question searches it unadded (apps/qa/scope_serializers.py).

    Empty for an account with neither a programme nor a role, whose questions
    search the campus pages alone.
    """

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        # The cast is the one apps/accounts/views.py explains.
        user = cast("User", request.user)
        return Response(ScopeCourseSerializer(listed(user), many=True).data)
