"""Reading past conversations back, and deleting one: the sidebar, reopening a
thread, removing it.

Separate from apps/qa/views.py rather than added to it. That file is about one
thing — the boundary where a status code stops being available and a failure has
to travel inside a stream — and these endpoints are ordinary JSON endpoints with
none of that. Keeping them apart is also what stops that file from growing past
the point where the streaming rules stop being the first thing a reader meets.

Every one is scoped by owner in the queryset itself, not checked afterwards. A
filter cannot forget: there is no code path here that can return or delete a
row belonging to somebody else, so there is nothing to review each time the
file changes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import transaction
from rest_framework.generics import ListAPIView, RetrieveDestroyAPIView

from apps.qa.models import Conversation
from apps.qa.serializers import ConversationDetailSerializer, ConversationSerializer

if TYPE_CHECKING:
    from django.db.models import Model, QuerySet


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


class ConversationDetailView(RetrieveDestroyAPIView):
    """One thread with its messages, in the shape the live stream delivers; or
    its deletion.

    A conversation that is not the caller's is missing rather than forbidden:
    the queryset simply does not contain it, so the answer is a 404, to a read
    and to a delete alike. That is the right answer as well as the convenient
    one — a 403 would confirm that the id names something real.

    Deleting is hard: the messages go with the conversation (`CASCADE`), as
    they do in Open WebUI, LibreChat, vercel/chatbot and LobeChat (docs/decisions.md,
    2026-09-29, *A slides citation opens its whole PDF, and a conversation is
    deleted outright*). There is no update: titles derive from the first
    question and are never stored.
    """

    serializer_class = ConversationDetailSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        # `prefetch_related` because the detail serializer walks the messages:
        # without it the reply costs one query per turn.
        return Conversation.objects.filter(owner=self.request.user).prefetch_related("messages")

    # `Model`, not `Conversation`: DRF's stubs type the mixin's parameter as a
    # method-level type variable, which an override may only widen.
    def perform_destroy(self, instance: Model) -> None:
        with transaction.atomic():
            # The row lock `record_exchange` takes too (apps/qa/conversations.py).
            # Of a delete and a queued question racing for one conversation,
            # whichever locks second sees what the first committed: without it,
            # the delete could collect no messages, the question write its two,
            # and the delete then fail on their foreign key.
            locked = Conversation.objects.select_for_update().filter(pk=instance.pk).first()
            if locked is not None:
                locked.delete()
