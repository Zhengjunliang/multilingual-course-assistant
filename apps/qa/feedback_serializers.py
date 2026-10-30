"""The shapes of a rating: what a student sends, and what the superuser's page
that reads the ratings shows. What the student reads back sits with the
conversation it is read in (apps/qa/serializers.py, `StoredFeedbackSerializer`).

The page's shapes name no student. They are read to find the answers that went
wrong and why, which needs the question, the answer and what it drew on, and
not who asked: so neither the account nor the conversation is in them, as
Onyx's query history set to `anonymized` shows the operator a chat without its
user (outside the repository; docs/decisions.md, 2026-10-30, *A student rates
an answer up or down*).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from rest_framework import serializers

from apps.qa.conversations import thread, window
from apps.qa.models import MAX_COMMENT_CHARS, Feedback, Message
from apps.qa.serializers import TurnSerializer
from config.errors import FieldReason, field_error
from rag.chunk import normalize_locale

if TYPE_CHECKING:
    from rest_framework.utils.serializer_helpers import ReturnDict


class FeedbackRequest(serializers.Serializer):
    """A rating as a student sends it: the whole of it, which replaces any before.

    `reason` and `comment` say why an answer is rated down, and a rating up
    carrying either is refused rather than stored without it. `locale` is the
    language the comment is written in, the interface's, required with a
    comment and dropped without one, since a rating alone has no language.
    """

    rating = serializers.ChoiceField(choices=Feedback.Rating.choices)
    reason = serializers.ChoiceField(choices=Feedback.Reason.choices, required=False)
    comment = serializers.CharField(
        max_length=MAX_COMMENT_CHARS, required=False, allow_blank=True, trim_whitespace=True
    )
    locale = serializers.CharField(required=False)

    def validate_locale(self, value: str) -> str:
        """As a question's (`AskRequest.validate_locale`)."""
        try:
            return normalize_locale(value)
        except ValueError as exc:
            raise field_error(FieldReason.INVALID) from exc

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        reason: str = attrs.get("reason", "")
        comment: str = attrs.get("comment", "")
        if attrs["rating"] == Feedback.Rating.UP:
            for field, value in (("reason", reason), ("comment", comment)):
                if value:
                    raise field_error(FieldReason.INVALID, field=field)
        locale: str = attrs.get("locale", "")
        if comment and not locale:
            raise field_error(FieldReason.REQUIRED, field="locale")
        return {
            "rating": attrs["rating"],
            "reason": reason,
            "comment": comment,
            "locale": locale if comment else "",
        }


def question_of(feedback: Feedback) -> str:
    """The question the rated answer answers: its parent, always, since
    `record_exchange` writes an answer under its question."""
    question = feedback.answer.parent
    return question.text if question is not None else ""


class FeedbackRowSerializer(serializers.ModelSerializer[Feedback]):
    """A rating in the page's list: what it says and what it rates.

    `id` is the answer's, which keys the rating. `comment_locale` is the
    language the comment is written in, which the list sets it in. `target` is
    where the answer was searched (`RouteDecision.target`), the scenario;
    `locale` is the language it was asked and answered in.
    """

    id = serializers.UUIDField(source="answer_id", read_only=True)
    comment_locale = serializers.CharField(source="locale", read_only=True)
    question = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()
    locale = serializers.CharField(source="answer.locale", read_only=True)

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Feedback
        fields = (
            "id",
            "rating",
            "reason",
            "comment",
            "comment_locale",
            "updated_at",
            "question",
            "target",
            "locale",
        )

    def get_question(self, feedback: Feedback) -> str:
        return question_of(feedback)

    def get_target(self, feedback: Feedback) -> str | None:
        route: dict[str, Any] | None = feedback.answer.route
        return route["target"] if route is not None else None


class RatedAnswerSerializer(serializers.ModelSerializer[Message]):
    """The answer a rating rates, as the stream delivered it, and the request
    that produced it."""

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Message
        fields = (
            "text",
            "locale",
            "complete",
            "citations",
            "route",
            "search_ms",
            "request_id",
            "created_at",
        )


class FeedbackDetailSerializer(serializers.ModelSerializer[Feedback]):
    """One rating opened: what it says and the comment's language, the answer
    whole, and the history its question was asked with.

    The history is what the prompt held, cut from the thread above the question
    by the same window the question was asked with (`window`): a follow-up
    such as "and the second one?" reads only beside it.
    """

    id = serializers.UUIDField(source="answer_id", read_only=True)
    comment_locale = serializers.CharField(source="locale", read_only=True)
    question = serializers.SerializerMethodField()
    answer = RatedAnswerSerializer(read_only=True)
    history = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = Feedback
        fields = (
            "id",
            "rating",
            "reason",
            "comment",
            "comment_locale",
            "created_at",
            "updated_at",
            "question",
            "answer",
            "history",
        )

    def get_question(self, feedback: Feedback) -> str:
        return question_of(feedback)

    def get_history(self, feedback: Feedback) -> list[ReturnDict[str, Any]]:
        """Raises `ConversationGoneError` for a conversation deleted since the
        rating was read, as `ConversationDetailSerializer.get_messages` does."""
        question = feedback.answer.parent
        if question is None:
            return []
        messages = Message.objects.filter(conversation_id=feedback.answer.conversation_id)
        return [TurnSerializer(turn).data for turn in window(thread(question.parent_id, messages))]
