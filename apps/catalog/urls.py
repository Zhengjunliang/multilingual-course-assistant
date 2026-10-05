"""URL map for the catalogue API; config/urls.py mounts it under `/api/catalog/`."""

from django.urls import path, register_converter

from apps.catalog.staff_views import (
    EditionTeachersView,
    EditionTeacherView,
    ProgrammeSecretariatMemberView,
    ProgrammeSecretariatView,
)
from apps.catalog.views import (
    CourseDetailView,
    EditionDetailView,
    EditionListView,
    EditionSetCurrentView,
    ProgrammeCoursesView,
    ProgrammeDetailView,
    ProgrammeListView,
)


class _Key:
    """A programme or course code, or a username: letters, digits and the marks Django's username
    validator allows. Anything else, a NUL byte included, cannot name one, so it is a 404 before
    any query rather than a value PostgreSQL refuses."""

    regex = r"[\w.@+-]+"

    def to_python(self, value: str) -> str:
        return value

    def to_url(self, value: str) -> str:
        return value


register_converter(_Key, "key")

app_name = "catalog"

urlpatterns = [
    # No trailing slash, matching the rest of the API (apps/qa/urls.py).
    path("programmes", ProgrammeListView.as_view(), name="programmes"),
    path("programmes/<key:code>", ProgrammeDetailView.as_view(), name="programme"),
    path("programmes/<key:code>/courses", ProgrammeCoursesView.as_view(), name="programme-courses"),
    path(
        "programmes/<key:code>/secretariat",
        ProgrammeSecretariatView.as_view(),
        name="programme-secretariat",
    ),
    path(
        "programmes/<key:code>/secretariat/<key:username>",
        ProgrammeSecretariatMemberView.as_view(),
        name="programme-secretariat-member",
    ),
    path("courses/<key:code>", CourseDetailView.as_view(), name="course"),
    path("editions", EditionListView.as_view(), name="editions"),
    path("editions/<int:pk>", EditionDetailView.as_view(), name="edition"),
    path("editions/<int:pk>/set-current", EditionSetCurrentView.as_view(), name="set-current"),
    path("editions/<int:pk>/teachers", EditionTeachersView.as_view(), name="edition-teachers"),
    path(
        "editions/<int:pk>/teachers/<key:username>",
        EditionTeacherView.as_view(),
        name="edition-teacher",
    ),
]
