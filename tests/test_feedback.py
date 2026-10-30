"""A student's rating of an answer, and the superuser's page that reads them.

The exchanges are written straight into the tables, as the sidebar's tests
write them (tests/test_conversation_list.py): the engine that writes them is
tests/test_qa_api.py's subject. Who may reach each endpoint at all is
tests/access_matrix.txt's; here, what each does for the one who may.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from rest_framework.test import APIClient
from test_conversation_list import START, client, owner, started, turn, web
from test_error_contract import refused

from apps.accounts.models import User
from apps.qa import feedback_views
from apps.qa.models import HISTORY_WINDOW_TURNS, Conversation, Feedback, Message

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/conversations"
LIST = "/api/admin/feedback"


def url(answer: Message) -> str:
    return f"/api/answers/{answer.pk}/feedback"


def answer_of(conversation: Conversation) -> Message:
    """Its last answer, by the leaf as stored: `turn` moves it with an update."""
    leaf = Conversation.objects.values_list("current_leaf", flat=True).get(pk=conversation.pk)
    return Message.objects.get(pk=leaf)


def rate(answer: Message, body: dict[str, Any], api: APIClient | None = None) -> Any:
    return (api or client()).put(url(answer), body, format="json")


# The student's side


def test_a_rating_is_stored_replaced_and_read_back_under_its_answer() -> None:
    """Rated down with why, then up: a rating up says no why, so the reason,
    the comment and the comment's language go with it."""
    answer = answer_of(started(0))

    down = rate(
        answer,
        {
            "rating": "down",
            "reason": "not_answered",
            "comment": " Non risponde. ",
            "locale": "it-IT",
        },
    )
    assert (down.status_code, down.json()) == (
        200,
        {"rating": "down", "reason": "not_answered", "comment": "Non risponde."},
    )
    assert Feedback.objects.get().locale == "it"

    up = rate(answer, {"rating": "up"})
    assert up.json() == {"rating": "up", "reason": "", "comment": ""}
    assert Feedback.objects.values_list("locale", flat=True).get() == ""

    question, rated = client().get(f"{CONVERSATIONS}/{answer.conversation_id}").json()["messages"]
    assert (question["feedback"], rated["feedback"]) == (None, up.json())


def test_a_language_without_a_comment_is_not_kept() -> None:
    answer = answer_of(started(0))
    rate(answer, {"rating": "down", "reason": "other", "locale": "en"})
    assert Feedback.objects.values_list("reason", "locale").get() == ("other", "")


def test_withdrawing_a_rating_deletes_it_and_can_be_repeated() -> None:
    answer = answer_of(started(0))
    rate(answer, {"rating": "down"})

    assert [client().delete(url(answer)).status_code for _ in range(2)] == [204, 204]
    assert not Feedback.objects.exists()


@pytest.mark.parametrize("method", ["put", "delete"])
@pytest.mark.parametrize("which", ["another student's", "a question", "unfinished", "unknown"])
def test_only_a_complete_answer_of_ones_own_is_rated(which: str, method: str) -> None:
    """Anything else is missing rather than forbidden, as a conversation that
    is not the caller's is: a 403 would say the id names something real."""
    conversation = started(0)
    answer = answer_of(conversation)
    target = answer
    if which == "another student's":
        Conversation.objects.filter(pk=conversation.pk).update(
            owner=User.objects.create(username="other")
        )
    elif which == "a question":
        target = Message.objects.get(pk=answer.parent_id)
    elif which == "unfinished":
        Message.objects.filter(pk=answer.pk).update(complete=False)
    else:
        target = Message(pk=answer.conversation_id)

    response = getattr(client(), method)(url(target), {"rating": "up"}, format="json")

    assert (response.status_code, refused(response)) == (404, ("NOT_FOUND", {}))
    assert not Feedback.objects.exists()


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        pytest.param({}, {"rating": ["REQUIRED"]}, id="no-rating"),
        pytest.param({"rating": "meh"}, {"rating": ["INVALID"]}, id="unknown-rating"),
        pytest.param(
            {"rating": "down", "reason": "wrong_sources"},
            {"reason": ["INVALID"]},
            id="unknown-reason",
        ),
        pytest.param(
            {"rating": "up", "reason": "other"}, {"reason": ["INVALID"]}, id="up-with-why"
        ),
        pytest.param(
            {"rating": "up", "comment": "Bene.", "locale": "it"},
            {"comment": ["INVALID"]},
            id="up-with-comment",
        ),
        pytest.param(
            {"rating": "down", "comment": "Sbagliata."}, {"locale": ["REQUIRED"]}, id="no-language"
        ),
        pytest.param(
            {"rating": "down", "comment": "x" * 1025, "locale": "it"},
            {"comment": ["TOO_LONG"]},
            id="comment-too-long",
        ),
    ],
)
def test_a_rating_the_client_got_wrong_is_refused(
    body: dict[str, Any], fields: dict[str, list[str]]
) -> None:
    answer = answer_of(started(0))
    response = rate(answer, body)
    assert (response.status_code, refused(response)) == (400, ("INVALID_ARGUMENT", fields))
    assert not Feedback.objects.exists()


def test_a_deleted_conversation_takes_its_ratings_along() -> None:
    answer = answer_of(started(0))
    rate(answer, {"rating": "down"})

    assert client().delete(f"{CONVERSATIONS}/{answer.conversation_id}").status_code == 204
    assert not Feedback.objects.exists()


# The superuser's page


def root() -> APIClient:
    user, _ = User.objects.get_or_create(
        username="root", defaults={"is_superuser": True, "is_staff": True}
    )
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def rated(
    minute: int,
    rating: str,
    *,
    reason: str = "",
    comment: str = "",
    comment_locale: str = "",
    target: str = "unifi_web",
    locale: str = "it",
    question: str = "Che cos'è un ORM?",
) -> Message:
    """A conversation of one exchange whose answer is rated `minute` minutes after `START`."""
    conversation = Conversation.objects.create(owner=owner(), locale="it")
    turn(conversation, minute, [web()], locale=locale, question=question)
    answer = answer_of(conversation)
    route = {"target": target, "query": question, "fresh": False, "reason": "test"}
    Message.objects.filter(pk=answer.pk).update(route=route, request_id="a" * 32)
    Feedback.objects.create(
        answer=answer, rating=rating, reason=reason, comment=comment, locale=comment_locale
    )
    Feedback.objects.filter(pk=answer.pk).update(updated_at=START + timedelta(minutes=minute))
    return answer


IDENTITY = {"owner", "user", "username", "conversation", "conversation_id"}


def page(query: str = "") -> dict[str, Any]:
    response = root().get(f"{LIST}{query}")
    assert response.status_code == 200
    return response.json()


def test_the_list_reads_newest_first_counted_and_without_a_name() -> None:
    older = rated(0, "up", question="Quando si paga?")
    newer = rated(
        5,
        "down",
        reason="incorrect",
        comment="说错了",
        comment_locale="zh",
        target="slides",
        locale="en",
    )

    listed = page()

    assert listed["count"] == 2
    assert [row["id"] for row in listed["results"]] == [str(newer.pk), str(older.pk)]
    first = listed["results"][0]
    keys = ("rating", "reason", "comment", "comment_locale", "target", "locale")
    assert {key: first[key] for key in keys} == {
        "rating": "down",
        "reason": "incorrect",
        "comment": "说错了",
        "comment_locale": "zh",
        "target": "slides",
        "locale": "en",
    }
    assert first["question"] == "Che cos'è un ORM?"
    assert not IDENTITY & set(first)


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("?rating=down", ["wrong"]),
        ("?reason=wrong_language", ["wrong"]),
        ("?target=slides", ["course"]),
        ("?locale=en-GB", ["course"]),
        ("?rating=up&target=unifi_web", ["right"]),
        ("?rating=meh", []),
        ("?reason=wrong_sources", []),
        ("?target=web", []),
        ("?locale=xx", []),
    ],
)
def test_the_list_narrows_by_rating_reason_scenario_and_language(
    query: str, expected: list[str]
) -> None:
    """A value none can match narrows to nothing, as the accounts' filters do."""
    answers = {
        "right": rated(0, "up"),
        "wrong": rated(1, "down", reason="wrong_language"),
        "course": rated(2, "up", target="slides", locale="en"),
    }
    ids = {str(answer.pk): name for name, answer in answers.items()}

    listed = page(query)

    assert sorted(ids[row["id"]] for row in listed["results"]) == sorted(expected)
    assert listed["count"] == len(expected)


def test_a_rating_opened_shows_the_history_its_question_was_asked_with() -> None:
    """Cut by the window the prompt was: the exchanges before the question,
    `HISTORY_WINDOW_TURNS` of them at most, and nothing after the answer."""
    conversation = started(0)
    for minute in range(1, 6):
        turn(conversation, minute, [web()], question=f"Domanda {minute}?")
    rated_answer = Message.objects.get(conversation=conversation, parent__text="Domanda 4?")
    Message.objects.filter(pk=rated_answer.pk).update(request_id="b" * 32)
    Feedback.objects.create(
        answer=rated_answer, rating="down", reason="other", comment="Boh.", locale="it"
    )

    detail = root().get(f"{LIST}/{rated_answer.pk}").json()

    assert detail["question"] == "Domanda 4?"
    assert [each["question"] for each in detail["history"]] == [
        f"Domanda {minute}?" for minute in range(4 - HISTORY_WINDOW_TURNS, 4)
    ]
    assert (detail["comment"], detail["comment_locale"]) == ("Boh.", "it")
    assert detail["answer"]["request_id"] == "b" * 32
    assert not IDENTITY & (set(detail) | set(detail["answer"]))


def test_a_rating_unknown_or_deleted_while_opened_is_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Its conversation deleted after the rating was read and before its
    history was: the 404 the next read gets, not a 500."""
    conversation = started(0)
    turn(conversation, 1, [web()], question="E poi?")
    answer = answer_of(conversation)
    Feedback.objects.create(answer=answer, rating="up")
    found = feedback_views.get_object_or_404

    def then_deleted(*args: Any, **kwargs: Any) -> Feedback:
        feedback = found(*args, **kwargs)
        Conversation.objects.filter(pk=conversation.pk).delete()
        return feedback

    monkeypatch.setattr(feedback_views, "get_object_or_404", then_deleted)

    for pk in (answer.conversation_id, answer.pk):
        response = root().get(f"{LIST}/{pk}")
        assert (response.status_code, refused(response)) == (404, ("NOT_FOUND", {}))
