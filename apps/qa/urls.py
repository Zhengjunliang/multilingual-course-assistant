"""URL map for the question API; config/urls.py mounts it under `/api/`."""

from django.urls import path

from apps.qa.conversation_views import ConversationDetailView, ConversationListView
from apps.qa.views import AskView

app_name = "qa"

urlpatterns = [
    # No trailing slash: the documented path is `/api/ask`. APPEND_SLASH only
    # redirects when nothing resolves, so it cannot shadow this — and it could
    # not help a POST anyway, since a 301 drops the body.
    path("ask", AskView.as_view(), name="ask"),
    path("conversations", ConversationListView.as_view(), name="conversations"),
    path("conversations/<int:pk>", ConversationDetailView.as_view(), name="conversation"),
]
