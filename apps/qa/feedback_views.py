"""A student's rating of an answer, and the superuser's page that reads them.

A student rates the complete answers of their own conversations: a `PUT` on
the answer's feedback stores a rating whole, replacing the one before, and a
`DELETE` withdraws it, as Dify and Onyx withdraw one by deleting its row and
LibreChat takes a rating by `PUT` on its message (outside the repository).
Anything else — another student's answer, a question, an answer still being
written or stopped halfway — is missing rather than forbidden, as a
conversation that is not the caller's is (apps/qa/conversation_views.py).

The superuser reads every rating, newest first, filtered as Open WebUI's admin
page of feedback is sorted and opened (outside the repository), and never
learns whose it is (apps/qa/feedback_serializers.py).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.db import transaction
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperuser
from apps.qa.feedback_serializers import (
    FeedbackDetailSerializer,
    FeedbackRequest,
    FeedbackRowSerializer,
)
from apps.qa.models import Conversation, Feedback, Message
from apps.qa.serializers import StoredFeedbackSerializer
from config.errors import ErrorCode, fail
from rag.chunk import normalize_locale

if TYPE_CHECKING:
    from uuid import UUID

    from django.contrib.auth.models import AbstractBaseUser, AnonymousUser
    from django.db.models import QuerySet
    from rest_framework.request import Request


def rateable(user: AbstractBaseUser | AnonymousUser) -> QuerySet[Message]:
    """The answers `user` may rate: the complete ones of their own conversations."""
    return Message.objects.filter(
        conversation__owner=user, role=Message.Role.ASSISTANT, complete=True
    )


class AnswerFeedbackView(APIView):
    """`PUT` rates an answer and answers with the rating stored; `DELETE`
    withdraws it, a 204 whether or not there was one."""

    permission_classes = (IsAuthenticated,)
    # JSON only, as a conversation's `PATCH` (apps/qa/conversation_views.py).
    parser_classes = (JSONParser,)

    def put(self, request: Request, pk: UUID) -> Response:
        with transaction.atomic():
            answer = rateable(request.user).filter(pk=pk).first()
            if answer is None:
                fail(ErrorCode.NOT_FOUND)
            # After the lookup, as a conversation's `PATCH` reads its body: a
            # body refused before it would tell another student's answer from
            # a missing one by its 400.
            body = FeedbackRequest(data=request.data)
            body.is_valid(raise_exception=True)
            # The row lock the conversation's deletion takes: taken after it,
            # the conversation is gone and so is the answer; taken before it,
            # the deletion waits, then finds this rating and removes it with
            # its answer. Without it, a rating written while the deletion ran
            # would point at an answer that no longer exists.
            if (
                Conversation.objects.select_for_update().filter(pk=answer.conversation_id).first()
                is None
            ):
                fail(ErrorCode.NOT_FOUND)
            feedback, _ = Feedback.objects.update_or_create(
                answer=answer, defaults=body.validated_data
            )
        return Response(StoredFeedbackSerializer(feedback).data)

    def delete(self, request: Request, pk: UUID) -> Response:
        if not rateable(request.user).filter(pk=pk).exists():
            fail(ErrorCode.NOT_FOUND)
        Feedback.objects.filter(answer_id=pk).delete()
        return Response(status=204)


class FeedbackPagination(PageNumberPagination):
    # A page a superuser reads down, as the accounts' (apps/accounts/manage_views.py).
    page_size = 50


# The scenarios a rating is filtered by: where its answer was searched.
TARGETS = ("slides", "unifi_web", "both")


def _locale(value: str) -> str | None:
    try:
        return normalize_locale(value)
    except ValueError:
        return None


class FeedbackListView(ListAPIView[Feedback]):
    """`GET`: every rating, newest first; `?rating=`, `?reason=`, `?target=`
    (where its answer was searched) and `?locale=` (the language it was asked
    and answered in) narrow them, and a value none can match narrows to
    nothing, as the accounts' filters do (apps/accounts/manage_views.py)."""

    permission_classes = (IsAuthenticated, IsSuperuser)
    serializer_class = FeedbackRowSerializer
    pagination_class = FeedbackPagination

    def get_queryset(self) -> QuerySet[Feedback]:
        ratings = Feedback.objects.select_related("answer__parent")
        params = self.request.query_params
        filters: dict[str, Any] = {}
        for param, lookup, allowed in (
            ("rating", "rating", Feedback.Rating.values),
            ("reason", "reason", Feedback.Reason.values),
            ("target", "answer__route__target", TARGETS),
        ):
            value = params.get(param)
            if value is not None:
                if value not in allowed:
                    return ratings.none()
                filters[lookup] = value
        if (value := params.get("locale")) is not None:
            if (locale := _locale(value)) is None:
                return ratings.none()
            filters["answer__locale"] = locale
        return ratings.filter(**filters)


class FeedbackDetailView(RetrieveAPIView[Feedback]):
    """`GET`: one rating, by its answer's id, with that answer and the history
    its prompt was given."""

    permission_classes = (IsAuthenticated, IsSuperuser)
    serializer_class = FeedbackDetailSerializer
    queryset = Feedback.objects.select_related("answer__parent")
