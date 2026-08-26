"""Reading past conversations back: the sidebar, and reopening a thread.

Separate from apps/qa/views.py rather than added to it. That file is about one
thing — the boundary where a status code stops being available and a failure has
to travel inside a stream — and these two endpoints are ordinary JSON reads with
none of that. Keeping them apart is also what stops that file from growing past
the point where the streaming rules stop being the first thing a reader meets.

Both are scoped by owner in the queryset itself, not checked afterwards. A
filter cannot forget: there is no code path here that can return a row belonging
to somebody else, so there is nothing to review each time the file changes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework.generics import ListAPIView, RetrieveAPIView

from apps.qa.models import Conversation
from apps.qa.serializers import ConversationDetailSerializer, ConversationSerializer

if TYPE_CHECKING:
    from django.db.models import QuerySet


class ConversationListView(ListAPIView):
    """Every thread this student owns that holds something, newest first.

    The exclusion is not tidiness. A conversation has to exist before the engine
    is called — the `start` event carries its id — so a question refused with a
    503 leaves an empty one behind. Deleting it would mean a write on every
    outage; leaving it in the sidebar would mean a row that opens onto nothing.
    Not listing what has no messages costs one join and is true by construction.
    """

    serializer_class = ConversationSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        return Conversation.objects.filter(owner=self.request.user).exclude(messages__isnull=True)


class ConversationDetailView(RetrieveAPIView):
    """One thread with its messages, in the shape the live stream delivers.

    A conversation that is not the caller's is missing rather than forbidden:
    the queryset simply does not contain it, so the answer is a 404. That is the
    right answer as well as the convenient one — a 403 would confirm that the id
    names something real.
    """

    serializer_class = ConversationDetailSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        # `prefetch_related` because the detail serializer walks the messages:
        # without it the reply costs one query per turn.
        return Conversation.objects.filter(owner=self.request.user).prefetch_related("messages")
