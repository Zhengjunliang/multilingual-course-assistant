"""URL map for the catalogue API; config/urls.py mounts it under `/api/catalog/`."""

from django.urls import path

from apps.catalog.views import EditionListView, EditionSetCurrentView, ProgrammeListView

app_name = "catalog"

urlpatterns = [
    # No trailing slash, matching the rest of the API (apps/qa/urls.py).
    path("programmes", ProgrammeListView.as_view(), name="programmes"),
    path("editions", EditionListView.as_view(), name="editions"),
    path("editions/<int:pk>/set-current", EditionSetCurrentView.as_view(), name="set-current"),
]
