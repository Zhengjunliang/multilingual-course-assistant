"""URL map for the superuser's page of background work; config/urls.py mounts it
under `/api/admin/`, beside the accounts' and the ratings' (apps/qa/review_urls.py)."""

from django.urls import path

from apps.system.views import ActivityView

app_name = "system"

urlpatterns = [
    # No trailing slash, as in apps/qa/urls.py.
    path("activity", ActivityView.as_view(), name="activity"),
]
