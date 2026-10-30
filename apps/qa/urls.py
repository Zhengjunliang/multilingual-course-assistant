"""URL map for the question API; config/urls.py mounts it under `/api/`."""

from django.urls import path, re_path

from apps.qa.conversation_views import ConversationDetailView, ConversationListView
from apps.qa.source_views import SourceView
from apps.qa.views import AnswerEventsView, AskView, StopAnswerView

app_name = "qa"

urlpatterns = [
    # No trailing slash: the documented path is `/api/ask`. APPEND_SLASH only
    # redirects when nothing resolves, so it cannot shadow this — and it could
    # not help a POST anyway, since a 301 drops the body.
    path("ask", AskView.as_view(), name="ask"),
    # An answer's id is a UUID, as a conversation's is: anything else is a 404.
    path("answers/<uuid:pk>/events", AnswerEventsView.as_view(), name="answer-events"),
    path("answers/<uuid:pk>/stop", StopAnswerView.as_view(), name="answer-stop"),
    path("conversations", ConversationListView.as_view(), name="conversations"),
    # Anything but a UUID in lower-case hex resolves nowhere: a 404, as an
    # unknown id is.
    path("conversations/<uuid:pk>", ConversationDetailView.as_view(), name="conversation"),
    # Exactly a sha256 as a material's row records it: nothing that could be a
    # path, and an upper-case key is a 404 rather than a second spelling.
    re_path(r"^sources/(?P<sha256>[0-9a-f]{64})$", SourceView.as_view(), name="source"),
]
