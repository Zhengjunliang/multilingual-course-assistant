"""URL map for the superusers' page of ratings; config/urls.py mounts it under
`/api/admin/`, beside the accounts' (apps/accounts/manage_urls.py).

`review` as the namespace: the ratings are the question-answering app's, and
the accounts' namespace, `manage`, names that app's own routes.
"""

from django.urls import path

from apps.qa.feedback_views import FeedbackDetailView, FeedbackListView

app_name = "review"

urlpatterns = [
    # No trailing slash, as in apps/qa/urls.py.
    path("feedback", FeedbackListView.as_view(), name="feedback"),
    # Keyed by its answer's id: anything but a UUID is a 404.
    path("feedback/<uuid:pk>", FeedbackDetailView.as_view(), name="feedback-item"),
]
