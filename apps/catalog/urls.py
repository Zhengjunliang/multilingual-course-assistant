"""URL map for the catalogue API; config/urls.py mounts it under `/api/catalog/`."""

from django.urls import path

from apps.catalog.staff_views import (
    EditionTeachersView,
    EditionTeacherView,
    ProgrammeSecretariatMemberView,
    ProgrammeSecretariatView,
)
from apps.catalog.views import EditionListView, EditionSetCurrentView, ProgrammeListView

app_name = "catalog"

urlpatterns = [
    # No trailing slash, matching the rest of the API (apps/qa/urls.py).
    path("programmes", ProgrammeListView.as_view(), name="programmes"),
    path(
        "programmes/<str:code>/secretariat",
        ProgrammeSecretariatView.as_view(),
        name="programme-secretariat",
    ),
    path(
        "programmes/<str:code>/secretariat/<str:username>",
        ProgrammeSecretariatMemberView.as_view(),
        name="programme-secretariat-member",
    ),
    path("editions", EditionListView.as_view(), name="editions"),
    path("editions/<int:pk>/set-current", EditionSetCurrentView.as_view(), name="set-current"),
    path("editions/<int:pk>/teachers", EditionTeachersView.as_view(), name="edition-teachers"),
    path(
        "editions/<int:pk>/teachers/<str:username>",
        EditionTeacherView.as_view(),
        name="edition-teacher",
    ),
]
