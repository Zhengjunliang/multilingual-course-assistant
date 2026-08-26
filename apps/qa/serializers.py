"""Request parsing for `/api/ask`, and the shapes the conversation API returns.

DRF serializers rather than pydantic on this side: this is what `APIView` calls,
and its `ValidationError` is what produces the documented 400 body. The answer
stream travels the other way and is pydantic — see apps/qa/contract.py for why
the two directions differ. The conversation endpoints are ordinary JSON in both
directions, so they stay here with the rest of the DRF layer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.qa.models import Conversation, Message
from rag.chunk import normalize_locale

if TYPE_CHECKING:
    from rest_framework.request import Request

# A 4B model's context is a shared, GPU-bound resource: every question is queued
# onto the one card this project has, and the prompt built around it — system
# instructions, retrieved excerpts, the question — has to fit a window measured
# in thousands of tokens. The cap is the same reasoning the roadmap applies to
# upload page counts: an unbounded input is an unbounded cost. A login does not
# change that; it only says whose cost it is.
MAX_QUESTION_CHARS = 1000

# How much of the first question becomes a sidebar row's label. Long enough to
# tell two threads about the same lecture apart, short enough not to wrap.
TITLE_CHARS = 60


class AskRequest(serializers.Serializer):
    """A question, optionally continuing a conversation. The rest is inferred."""

    question = serializers.CharField(max_length=MAX_QUESTION_CHARS, trim_whitespace=True)
    # Omitted or null starts a new conversation; the id of the one that was
    # started comes back in the `start` event.
    conversation_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    # Optional: with no locale the engine detects one from the question itself,
    # which is what the CLI does. An empty string is not a locale — `allow_null`
    # without `allow_blank` makes "omitted" and "null" the only ways to say
    # "decide for me", and `""` a validation error rather than a silent default.
    locale = serializers.CharField(required=False, allow_null=True, default=None)

    def validate_locale(self, value: str | None) -> str | None:
        """`it-IT` and `IT` both mean `it`; `itt` is an error, not a filter.

        The rule itself lives in `rag.chunk.normalize_locale`, which the CLI
        flags validate against too — one implementation, two entry points.
        """
        if value is None:
            return None
        try:
            return normalize_locale(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """Resolve the conversation id into the row, or refuse it.

        One message for "no such conversation" and for "that one is not yours",
        because they must not be distinguishable: a client that could tell them
        apart could count how many conversations exist and whose they are. What
        is left is a request for something the caller has no way to name, which
        is what a 400 says.

        The lookup only runs when an id was actually sent. That is what keeps
        the everyday first question of a conversation — and every test in
        tests/test_qa_api.py that does not name one — free of a query.
        """
        attrs["conversation"] = None
        conversation_id = attrs.get("conversation_id")
        if conversation_id is None:
            return attrs

        request: Request = self.context["request"]
        conversation = Conversation.objects.filter(pk=conversation_id, owner=request.user).first()
        if conversation is None:
            raise serializers.ValidationError({"conversation_id": _("No such conversation.")})
        attrs["conversation"] = conversation
        return attrs


class MessageSerializer(serializers.ModelSerializer[Message]):
    """One stored turn, in the shape the interface already knows how to draw.

    `citations` and `route` come back as they were stored, which is the shape
    the `start` event delivered them in (apps/qa/contract.py). That is the whole
    point of storing them: a reopened conversation renders through exactly the
    same code as a live one, badges and greyed-out sources included, instead of
    a second rendering path for history that would drift from the first.
    """

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Message
        fields = ("id", "role", "text", "locale", "complete", "citations", "route", "created_at")


class ConversationSerializer(serializers.ModelSerializer[Conversation]):
    """A conversation in a list: enough to draw a sidebar row and no more.

    `title` is derived rather than stored. A stored title is a second copy of
    the first question, free to disagree with it the moment either is edited.
    """

    title = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Conversation
        fields = ("id", "locale", "created_at", "title")

    def get_title(self, conversation: Conversation) -> str:
        first = (
            Message.objects.filter(conversation=conversation, role=Message.Role.USER)
            .values_list("text", flat=True)
            .first()
        )
        return (first or "")[:TITLE_CHARS]


class ConversationDetailSerializer(ConversationSerializer):
    """The same row with its messages, for reopening a thread."""

    messages = MessageSerializer(many=True, read_only=True)

    class Meta(ConversationSerializer.Meta):
        fields = (*ConversationSerializer.Meta.fields, "messages")
