"""The sidebar's list: what a row carries besides its title, the order the rows
come in, and pinning one.

The rows are written straight into the tables rather than through `/api/ask`.
What a row shows is derived from its stored messages, so the messages are this
file's input; the engine that writes them is tests/test_qa_api.py's subject.
Every timestamp is set rather than left to `auto_now_add`, because the order
under test is the order of those timestamps, and two rows written in one test
can share one.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Course
from apps.qa.contract import Citation
from apps.qa.models import Conversation, Message

pytestmark = pytest.mark.django_db

URL = "/api/conversations"
START = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def owner() -> User:
    user, _ = User.objects.get_or_create(username="student")
    return user


def client() -> APIClient:
    api = APIClient()
    api.force_authenticate(user=owner())
    return api


def slides(course: str) -> dict[str, Any]:
    return Citation(
        marker="[deck.pdf p.1]",
        kind="slides",
        text="An ORM maps objects to tables.",
        heading_path=[],
        course=course,
        academic_year="2025-2026",
        locale="it",
        score=1.0,
        source_file="deck.pdf",
        source_sha256="0" * 64,
        page=1,
        url=None,
        fetch_date=None,
    ).model_dump(mode="json")


def web() -> dict[str, Any]:
    return Citation(
        marker="[https://www.unifi.it/it/tasse · 2026-08-01]",
        kind="web",
        text="Le tasse scadono il 30 novembre.",
        heading_path=[],
        course="ingegneria",
        academic_year=None,
        locale="it",
        score=1.0,
        source_file="https://www.unifi.it/it/tasse",
        source_sha256=None,
        page=0,
        url="https://www.unifi.it/it/tasse",
        fetch_date="2026-08-01",
    ).model_dump(mode="json")


def turn(
    conversation: Conversation,
    minute: int,
    citations: list[dict[str, Any]],
    *,
    locale: str = "it",
    question: str = "Che cos'è un ORM?",
) -> None:
    """One exchange, `minute` minutes after `START`: the question, then its
    answer with the excerpts it was given (none for a refusal)."""
    asked = Message.objects.create(
        conversation=conversation, role=Message.Role.USER, text=question, locale=locale
    )
    answered = Message.objects.create(
        conversation=conversation,
        role=Message.Role.ASSISTANT,
        text="…",
        locale=locale,
        complete=True,
        citations=citations,
    )
    at = START + timedelta(minutes=minute)
    Message.objects.filter(pk=asked.pk).update(created_at=at)
    Message.objects.filter(pk=answered.pk).update(created_at=at + timedelta(seconds=1))


def started(minute: int, citations: list[dict[str, Any]] | None = None) -> Conversation:
    conversation = Conversation.objects.create(owner=owner(), locale="it")
    turn(conversation, minute, citations if citations is not None else [web()])
    return conversation


def rows() -> list[dict[str, Any]]:
    return client().get(URL).json()


def only_row() -> dict[str, Any]:
    (row,) = rows()
    return row


PPM = ("B028451", "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE")
DB = ("B003376", "BASI DI DATI")


@pytest.mark.parametrize(
    ("citations", "source"),
    [
        pytest.param(
            [slides(PPM[0])],
            {"courses": [{"name": PPM[1], "locale": "it"}], "web": False},
            id="a-course",
        ),
        # Stored before the slides points carried a course code.
        pytest.param(
            [slides("PPM")],
            {"courses": [{"name": "PPM", "locale": None}], "web": False},
            id="a-code-no-course-holds",
        ),
        pytest.param([web(), web()], {"courses": [], "web": True}, id="the-university"),
        pytest.param(
            [web(), slides(PPM[0])],
            {"courses": [{"name": PPM[1], "locale": "it"}], "web": True},
            id="both",
        ),
        pytest.param(
            [slides(DB[0]), slides(PPM[0]), slides(DB[0])],
            {
                "courses": [{"name": DB[1], "locale": "it"}, {"name": PPM[1], "locale": "it"}],
                "web": False,
            },
            id="several-courses-in-citation-order-each-once",
        ),
    ],
)
def test_a_row_names_what_its_last_answer_drew_on(
    citations: list[dict[str, Any]], source: dict[str, Any]
) -> None:
    for code, name in (PPM, DB):
        Course.objects.create(code=code, name=name, locale="it")
    conversation = started(0, [web()])
    turn(conversation, 5, citations)

    assert only_row()["last_source"] == source


def test_an_answer_refused_for_lack_of_excerpts_leaves_the_source_of_the_one_before() -> None:
    conversation = started(0, [slides("PPM")])
    turn(conversation, 5, [])

    assert only_row()["last_source"] == {"courses": [{"name": "PPM", "locale": None}], "web": False}


def test_a_conversation_whose_every_answer_was_refused_has_no_source() -> None:
    conversation = started(0, [])
    turn(conversation, 5, [])

    assert only_row()["last_source"] is None


def test_the_title_carries_the_language_of_the_first_question() -> None:
    """A conversation has no single language; its title has its own."""
    conversation = Conversation.objects.create(owner=owner(), locale="it")
    turn(conversation, 0, [web()], locale="zh", question="考试报名截止日期是什么时候")
    turn(conversation, 5, [web()], locale="it", question="E per l'appello di febbraio?")

    row = only_row()

    assert (row["title"], row["title_locale"]) == ("考试报名截止日期是什么时候", "zh")


def test_the_list_follows_the_last_message_and_so_does_its_time() -> None:
    older = started(0)
    newer = started(10)
    turn(older, 20, [web()])

    body = rows()

    assert [row["id"] for row in body] == [older.pk, newer.pk]
    assert datetime.fromisoformat(body[0]["last_message_at"]) == START + timedelta(
        minutes=20, seconds=1
    )


def pin(conversation: Conversation, pinned: bool) -> Any:
    return client().patch(f"{URL}/{conversation.pk}", {"pinned": pinned}, format="json")


def test_pinning_puts_a_conversation_first_and_unpinning_returns_it_to_its_place() -> None:
    """The pinned group is ordered like the rest, by last message: pinning
    moves a row into it and reorders nothing (docs/api.md)."""
    first, second, third = started(0), started(10), started(20)

    response = pin(first, True)
    pin(second, True)
    pin(second, True)

    assert response.status_code == 200
    assert response.json() == next(row for row in rows() if row["id"] == first.pk)
    assert [(row["id"], row["pinned"]) for row in rows()] == [
        (second.pk, True),
        (first.pk, True),
        (third.pk, False),
    ]

    pin(first, False)

    assert [row["id"] for row in rows()] == [second.pk, third.pk, first.pk]
    assert Conversation.objects.get(pk=second.pk).pinned


def test_somebody_elses_conversation_cannot_be_pinned() -> None:
    stranger = User.objects.create_user(username="stranger")
    theirs = Conversation.objects.create(owner=stranger, locale="it")
    turn(theirs, 0, [web()])

    assert pin(theirs, True).status_code == 404
    assert not Conversation.objects.get(pk=theirs.pk).pinned


def test_pinned_is_the_only_field_a_conversation_takes() -> None:
    """Its title derives from the first question and is never written."""
    conversation = started(0)
    url = f"{URL}/{conversation.pk}"

    assert client().patch(url, {"title": "x"}, format="json").status_code == 400
    assert client().put(url, {"pinned": True}, format="json").status_code == 405
    assert only_row()["title"] == "Che cos'è un ORM?"


def test_a_form_without_pinned_is_refused_rather_than_read_as_unpinning() -> None:
    """DRF reads a boolean missing from a form as `False`, so a form body is
    refused whole: only JSON can say nothing about `pinned`."""
    conversation = started(0)
    pin(conversation, True)

    response = client().patch(f"{URL}/{conversation.pk}", {"title": "x"}, format="multipart")

    assert response.status_code == 415
    assert Conversation.objects.get(pk=conversation.pk).pinned


def test_the_browsable_api_opens_a_conversation() -> None:
    """DRF's HTML page builds its PATCH form from a serializer of its own."""
    Course.objects.create(code=PPM[0], name=PPM[1], locale="it")
    conversation = started(0, [slides(PPM[0])])

    response = client().get(f"{URL}/{conversation.pk}", HTTP_ACCEPT="text/html")

    assert response.status_code == 200


def test_reopening_a_conversation_returns_its_row_as_the_list_shows_it() -> None:
    Course.objects.create(code=PPM[0], name=PPM[1], locale="it")
    conversation = started(0, [slides(PPM[0]), web()])
    pin(conversation, True)

    detail = client().get(f"{URL}/{conversation.pk}").json()

    assert {key: value for key, value in detail.items() if key != "messages"} == only_row()


def test_the_list_costs_the_same_queries_for_thirty_conversations() -> None:
    """Each row's title, language and source, course names included, come in a
    fixed number of queries, however many rows there are."""

    def queries() -> int:
        with CaptureQueriesContext(connection) as captured:
            body = rows()
        assert all(row["last_source"]["courses"][0]["locale"] == "it" for row in body)
        return len(captured.captured_queries)

    Course.objects.create(code="B000000", name="CORSO 0", locale="it")
    started(0, [slides("B000000"), web()])
    one = queries()
    for n in range(1, 30):
        Course.objects.create(code=f"B{n:06d}", name=f"CORSO {n}", locale="it")
        started(n, [slides(f"B{n:06d}"), web()])

    assert queries() == one
