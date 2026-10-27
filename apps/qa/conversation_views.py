"""Reading past conversations back, pinning and deleting one: the sidebar,
reopening a thread, keeping it at the top, removing it.

Separate from apps/qa/views.py rather than added to it. That file is about one
thing — the boundary where a status code stops being available and a failure has
to travel inside a stream — and these endpoints are ordinary JSON endpoints with
none of that. Keeping them apart is also what stops that file from growing past
the point where the streaming rules stop being the first thing a reader meets.

Every one is scoped by owner in the queryset itself, not checked afterwards. A
filter cannot forget: there is no code path here that can return, change or
delete a row belonging to somebody else, so there is nothing to review each
time the file changes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.db.models import JSONField, OuterRef, Subquery
from django.db.models.functions import Left
from rest_framework.generics import GenericAPIView, ListAPIView, RetrieveDestroyAPIView
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.catalog.models import Course
from apps.qa.conversations import ConversationGoneError
from apps.qa.models import Conversation, Message
from apps.qa.serializers import (
    COURSE_NAMES,
    LAST_CITATIONS,
    TITLE_CHARS,
    ConversationDetailSerializer,
    ConversationSerializer,
    CourseName,
    PinSerializer,
    slides_courses,
)
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from collections.abc import Iterable

    from django.contrib.auth.base_user import AbstractBaseUser
    from django.contrib.auth.models import AnonymousUser
    from django.db.models import Model, QuerySet
    from rest_framework.request import Request


def summaries(owner: AbstractBaseUser | AnonymousUser) -> QuerySet[Conversation]:
    """The owner's conversations that hold something, each carrying what its
    sidebar row shows, pinned ones first and each group by its last message.

    Every value is a correlated subquery walking the index on (`conversation`,
    `created_at`), so a list of thirty costs the queries a list of one does,
    where a lookup per row would cost one each. An answer refused for want of
    excerpts is stored with none (apps/qa/engine.py), which is what lets the
    source skip it for the one before.

    A conversation with no messages is left out, everywhere, not only from the
    list: a question refused with a 503 leaves one behind, since the engine
    needs an id before it can fail. Deleting it would mean a write on every
    outage; listing it would mean a row that opens onto nothing; and its id
    never reached the client, which saw no `start` event.

    Pinning is a flag and the pinned rows are ordered like the rest, so pinning
    moves a row into its group and reorders nothing, as in LibreChat and
    LobeChat; the last message orders both, as in Open WebUI, LibreChat and
    LobeChat.
    """
    messages = Message.objects.filter(conversation=OuterRef("pk"))
    questions = messages.filter(role=Message.Role.USER).order_by("created_at", "id")
    sourced = (
        messages.filter(role=Message.Role.ASSISTANT)
        .exclude(citations=[])
        .order_by("-created_at", "-id")
    )
    return (
        Conversation.objects.filter(owner=owner)
        .annotate(
            last_message_at=Subquery(
                messages.order_by("-created_at", "-id").values("created_at")[:1]
            ),
            title=Left(Subquery(questions.values("text")[:1]), TITLE_CHARS),
            title_locale=Subquery(questions.values("locale")[:1]),
            **{LAST_CITATIONS: Subquery(sourced.values("citations")[:1], output_field=JSONField())},
        )
        .filter(last_message_at__isnull=False)
        .order_by("-pinned", "-last_message_at", "-id")
    )


def row_context(view: GenericAPIView, conversations: Iterable[Conversation]) -> dict[str, Any]:
    """The serializer context for these rows: the view's own, and the names of
    every course their sources cite, in one query for all of them.

    A code no `Course` holds is missing here and shown as stored: slides
    excerpts stored before the course codes named their course by `"PPM"`
    (docs/data-model.md, migration order).
    """
    codes = {
        code
        for conversation in conversations
        for code in slides_courses(getattr(conversation, LAST_CITATIONS) or [])
    }
    named = (
        {
            code: CourseName(name=name, locale=locale)
            for code, name, locale in Course.objects.filter(code__in=codes).values_list(
                "code", "name", "locale"
            )
        }
        if codes
        else {}
    )
    return {**view.get_serializer_context(), COURSE_NAMES: named}


class ConversationListView(ListAPIView):
    """Every thread this student owns that holds something (`summaries`)."""

    permission_classes = (IsAuthenticated,)
    serializer_class = ConversationSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        return summaries(self.request.user)

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        conversations = list(self.get_queryset())
        serializer = self.get_serializer(
            conversations, many=True, context=row_context(self, conversations)
        )
        return Response(serializer.data)


class ConversationDetailView(RetrieveDestroyAPIView):
    """One thread with its messages, in the shape the live stream delivers;
    pinning it; or its deletion.

    A conversation that is not the caller's is missing rather than forbidden:
    the queryset simply does not contain it, so the answer is a 404, to a read,
    a pin and a delete alike. That is the right answer as well as the convenient
    one — a 403 would confirm that the id names something real.

    `pinned` is the only field a conversation takes, by `PATCH`; there is no
    `PUT`, since the title derives from the first question and is never stored.

    Deleting is hard: the messages go with the conversation (`CASCADE`), as
    they do in Open WebUI, LibreChat, vercel/chatbot and LobeChat
    (docs/decisions.md, 2026-09-29, *A slides citation opens its whole PDF, and
    a conversation is deleted outright*).
    """

    permission_classes = (IsAuthenticated,)
    serializer_class = ConversationDetailSerializer
    # JSON only: DRF reads a boolean missing from a form as `False`, so a form
    # body naming anything but `pinned` would unpin rather than be refused.
    parser_classes = (JSONParser,)

    def get_queryset(self) -> QuerySet[Conversation]:
        return summaries(self.request.user)

    def retrieve(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        conversation = self.get_object()
        serializer = self.get_serializer(conversation, context=row_context(self, [conversation]))
        try:
            return Response(serializer.data)
        # Deleted from another tab after its row was read and before its
        # messages were: missing, as it is to the next read.
        except ConversationGoneError:
            fail(ErrorCode.NOT_FOUND)

    def patch(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """Pins or unpins it, and answers with its row as the list shows it."""
        conversation = self.get_object()
        pin = PinSerializer(data=request.data)
        pin.is_valid(raise_exception=True)
        pinned: bool = pin.validated_data["pinned"]
        # An update rather than `save()`: a conversation deleted from another
        # tab since `get_object` read it is a 404 here, not an error on a row
        # that is gone.
        if not Conversation.objects.filter(pk=conversation.pk).update(pinned=pinned):
            fail(ErrorCode.NOT_FOUND)
        conversation.pinned = pinned
        return Response(
            ConversationSerializer(conversation, context=row_context(self, [conversation])).data
        )

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
