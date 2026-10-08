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

from apps.qa.models import HISTORY_WINDOW_TURNS, Conversation, Message
from rag.answer import Turn
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

# How long an earlier answer in an anonymous `history` may be. The prompt keeps
# only the first `rag.answer.HISTORY_ANSWER_CHARS` of it either way; ten times
# that leaves a client room to send its answers cut at this cap and no more,
# and bounds what the server reads and holds for text no prompt will see.
MAX_HISTORY_ANSWER_CHARS = 4000

# How much of the first question becomes a sidebar row's label. Long enough to
# tell two threads about the same lecture apart, short enough not to wrap.
TITLE_CHARS = 60


class TurnSerializer(serializers.Serializer):
    """One earlier exchange, as an anonymous client sends it back.

    Untrusted, like everything in a request body: the client may send an answer
    the model never wrote. What that buys is limited to the forger's own
    answer, since nothing is stored and nobody else reads it, and less than a
    question could say: the router sees only the questions, and generation sees
    each exchange quoted (rag/answer.py, `format_history`). So the turns are
    bounded rather than signed. The answer may be empty, as a stored one is
    when its stream failed before the first token.
    """

    question = serializers.CharField(max_length=MAX_QUESTION_CHARS, trim_whitespace=True)
    answer = serializers.CharField(max_length=MAX_HISTORY_ANSWER_CHARS, allow_blank=True)


class AskRequest(serializers.Serializer):
    """A question, optionally continuing a conversation. The rest is inferred.

    A conversation continues in one of two ways, and a request uses the one
    that matches its caller. A logged-in caller names a stored conversation by
    `conversation_id`, and the server reads the history from it. An anonymous
    caller has nothing stored and sends `history` itself, its last few
    exchanges, oldest first: the cap is the window a stored conversation is
    cut to (`HISTORY_WINDOW_TURNS`), so the prompt is built the same way on
    both paths.
    """

    question = serializers.CharField(max_length=MAX_QUESTION_CHARS, trim_whitespace=True)
    # Omitted or null starts a new conversation; the id of the one that was
    # started comes back in the `start` event.
    conversation_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    # No default: `validate` tells an omitted history from an empty one, and a
    # logged-in caller may send neither. The list spelled out rather than
    # `many=True`, which builds the same one but whose stub drops `max_length`.
    history = serializers.ListSerializer(
        child=TurnSerializer(), required=False, max_length=HISTORY_WINDOW_TURNS
    )
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
        """Take the history from where the caller keeps it, and refuse the other source.

        Each caller has one source, and a request naming the other is a 400
        rather than a field quietly ignored: an anonymous caller has no stored
        conversation to continue, and a logged-in caller's history is the
        stored one, which a client-sent copy could only contradict.

        For a logged-in caller, the conversation id becomes the row, or a
        refusal. One message for "no such conversation" and for "that one is
        not yours", because they must not be distinguishable: a client that
        could tell them apart could count how many conversations exist and whose
        they are. What is left is a request for something the caller has no way
        to name, which is what a 400 says.

        The lookup only runs when an id was actually sent. That is what keeps
        the everyday first question of a conversation — and every test in
        tests/test_qa_api.py that does not name one — free of a query.
        """
        request: Request = self.context["request"]
        attrs["conversation"] = None
        if not request.user.is_authenticated:
            if attrs.get("conversation_id") is not None:
                raise serializers.ValidationError(
                    {"conversation_id": _("Without an account, send the history instead.")}
                )
            attrs["history"] = [Turn(**turn) for turn in attrs.get("history", [])]
            return attrs

        if "history" in attrs:
            raise serializers.ValidationError(
                {"history": _("With an account, send the conversation_id instead.")}
            )
        conversation_id = attrs.get("conversation_id")
        if conversation_id is None:
            return attrs

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
