"""URL map for the catalogue API; config/urls.py mounts it under `/api/catalog/`."""

import re

from django.urls import path, register_converter

from apps.catalog.content_views import (
    EditionReadingsView,
    EditionReadingView,
    EditionSyllabusSectionView,
    EditionSyllabusView,
)
from apps.catalog.invitation_views import (
    EditionInvitationsView,
    EditionInvitationView,
    InvitationListView,
    ProgrammeInvitationsView,
    ProgrammeInvitationView,
)
from apps.catalog.models import SyllabusSection
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
    ProgrammeCoursesView,
    ProgrammeDetailView,
    ProgrammeListView,
)
from apps.materials.views import EditionMaterialsView


class _Key:
    """A programme or course code, or a username: letters, digits and the marks Django's username
    validator allows. Anything else, a NUL byte included, cannot name one, so it is a 404 before
    any query rather than a value PostgreSQL refuses."""

    regex = r"[\w.@+-]+"

    def to_python(self, value: str) -> str:
        return value

    def to_url(self, value: str) -> str:
        return value


class _OneOf:
    """One value of a closed set, so a value outside it matches no route and is a 404."""

    regex: str

    def to_python(self, value: str) -> str:
        return value

    def to_url(self, value: str) -> str:
        return value


class _Section(_OneOf):
    """A section of a UniFi syllabus (apps/catalog/models.py)."""

    regex = "|".join(re.escape(section) for section in SyllabusSection.values)


register_converter(_Key, "key")
register_converter(_Section, "section")

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
    path(
        "programmes/<key:code>/invitations",
        ProgrammeInvitationsView.as_view(),
        name="programme-invitations",
    ),
    path(
        "programmes/<key:code>/invitations/<int:invitation>",
        ProgrammeInvitationView.as_view(),
        name="programme-invitation",
    ),
    path("courses/<key:code>", CourseDetailView.as_view(), name="course"),
    path("editions", EditionListView.as_view(), name="editions"),
    # Every scope's, for the superuser; each one's are under its scope.
    path("invitations", InvitationListView.as_view(), name="invitations"),
    path("editions/<int:pk>", EditionDetailView.as_view(), name="edition"),
    path("editions/<int:pk>/teachers", EditionTeachersView.as_view(), name="edition-teachers"),
    path(
        "editions/<int:pk>/teachers/<key:username>",
        EditionTeacherView.as_view(),
        name="edition-teacher",
    ),
    path(
        "editions/<int:pk>/invitations",
        EditionInvitationsView.as_view(),
        name="edition-invitations",
    ),
    path(
        "editions/<int:pk>/invitations/<int:invitation>",
        EditionInvitationView.as_view(),
        name="edition-invitation",
    ),
    path("editions/<int:pk>/syllabus", EditionSyllabusView.as_view(), name="edition-syllabus"),
    path(
        "editions/<int:pk>/syllabus/<section:section>",
        EditionSyllabusSectionView.as_view(),
        name="edition-syllabus-section",
    ),
    path("editions/<int:pk>/readings", EditionReadingsView.as_view(), name="edition-readings"),
    path(
        "editions/<int:pk>/readings/<int:item>",
        EditionReadingView.as_view(),
        name="edition-reading",
    ),
    # The edition's material is apps/materials', nested here as its other content is.
    path("editions/<int:pk>/materials", EditionMaterialsView.as_view(), name="edition-materials"),
]
