"""A conversation read as a thread: the chain of parents that orders it, the
row lock under which it grows, and what a reader is told when the chain or the
conversation is gone.

`thread` is driven directly for the shapes no request produces, a broken chain
and a cycle, and through `/api/conversations/<id>` and `recent_turns` for the
order a reader and the model see. The rows are written straight into the tables,
as in tests/test_conversation_list.py, or through `record_exchange` where the
write itself is the subject.
"""

from __future__ import annotations

import uuid

import pytest
from django.db import connection
from django.db.models import RestrictedError
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from test_conversation_list import START, URL, client, owner, started, turn, web
from test_error_contract import refused

from apps.accounts.models import User
from apps.qa.contract import StartEvent
from apps.qa.conversation_views import ConversationDetailView
from apps.qa.conversations import (
    BrokenThreadError,
    ConversationGoneError,
    recent_turns,
    record_exchange,
    thread,
)
from apps.qa.models import Conversation, Message
from rag.agent import RouteDecision
from rag.answer import Turn

pytestmark = pytest.mark.django_db

# Ids that sort the wrong way round: by id, the answer comes first.
QUESTION_ID = uuid.UUID("ffffffff-ffff-4fff-bfff-ffffffffffff")
ANSWER_ID = uuid.UUID("00000000-0000-4000-8000-000000000000")


def test_an_exchange_written_in_one_instant_reads_question_first() -> None:
    """Two rows of one exchange can share a timestamp to the microsecond, and a
    random id orders them by chance; the chain orders them every time, for the
    reader reopening the conversation and for the model reading its history."""
    conversation = Conversation.objects.create(owner=owner(), locale="it")
    asked = Message.objects.create(
        pk=QUESTION_ID,
        conversation=conversation,
        role=Message.Role.USER,
        text="Che cos'è un ORM?",
        locale="it",
        complete=True,
    )
    answered = Message.objects.create(
        pk=ANSWER_ID,
        conversation=conversation,
        parent=asked,
        role=Message.Role.ASSISTANT,
        text="Un ORM mappa oggetti su tabelle.",
        locale="it",
        complete=True,
    )
    Message.objects.filter(conversation=conversation).update(created_at=START)
    Conversation.objects.filter(pk=conversation.pk).update(current_leaf=answered)
    conversation.refresh_from_db()

    body = client().get(f"{URL}/{conversation.pk}").json()

    assert [message["id"] for message in body["messages"]] == [str(QUESTION_ID), str(ANSWER_ID)]
    assert recent_turns(conversation) == [
        Turn(question="Che cos'è un ORM?", answer="Un ORM mappa oggetti su tabelle.")
    ]


def start_event(question: str) -> StartEvent:
    return StartEvent(
        question=question,
        conversation_id=None,
        locale="it",
        route=RouteDecision(target="slides", query="orm", reason="course material"),
        citations=[],
        search_ms=0,
    )


def test_a_question_hangs_from_the_leaf_the_locked_row_holds() -> None:
    """A question that waited for the engine holds a copy of its conversation
    read before an exchange another tab wrote meanwhile. Hung from that copy's
    leaf it would fork the thread; hung from the locked row's, it follows the
    exchange it did not see."""
    conversation = Conversation.objects.create(owner=owner(), locale="it")
    stale = Conversation.objects.get(pk=conversation.pk)

    first = record_exchange(stale, start_event("Prima?"))
    with CaptureQueriesContext(connection) as captured:
        second = record_exchange(stale, start_event("Seconda?"))

    # Read under the lock, before anything is written: two questions reading
    # the same leaf would both hang from it, and the second to set the leaf
    # would drop the first exchange from the thread.
    reads = [
        query["sql"] for query in captured.captured_queries if query["sql"].startswith("SELECT")
    ]
    assert reads[0].endswith("FOR UPDATE")
    assert Message.objects.get(parent_id=first).text == "Seconda?"
    leaf = Conversation.objects.get(pk=conversation.pk).current_leaf_id
    assert leaf == second
    assert len(thread(leaf, Message.objects.filter(conversation=conversation))) == 4


def message(parent: uuid.UUID | None = None) -> Message:
    return Message(id=uuid.uuid4(), parent_id=parent)


def test_a_conversation_nothing_was_written_to_is_an_empty_thread() -> None:
    assert thread(None, []) == []


def test_a_leaf_with_no_rows_is_a_conversation_deleted_while_it_was_read() -> None:
    with pytest.raises(ConversationGoneError):
        thread(uuid.uuid4(), [])


def test_a_chain_that_does_not_reach_a_root_is_a_broken_thread() -> None:
    """A leaf missing from the rows, a parent missing from them, and a cycle:
    none of them is something a reader did, and none is read as a shorter
    thread."""
    root = message()
    orphan = message(parent=uuid.uuid4())
    first, second = message(), message()
    first.parent_id, second.parent_id = second.pk, first.pk

    for leaf, rows in (
        (uuid.uuid4(), [root]),
        (orphan.pk, [root, orphan]),
        (first.pk, [first, second]),
    ):
        with pytest.raises(BrokenThreadError):
            thread(leaf, rows)


@pytest.mark.parametrize("deleted", [True, False], ids=["deleted", "kept"])
def test_a_conversation_deleted_between_its_row_and_its_messages_is_not_found(
    monkeypatch: pytest.MonkeyPatch, deleted: bool
) -> None:
    """Deleted from another tab after the view read its row: the 404 the next
    read gets, not a 500. Kept, the same conversation opens, so the 404 comes
    from that window and not from a conversation the list would leave out."""
    conversation = started(0)
    if deleted:
        found = ConversationDetailView.get_object

        def then_deleted(view: ConversationDetailView) -> Conversation:
            row = found(view)
            Conversation.objects.filter(pk=row.pk).delete()
            return row

        monkeypatch.setattr(ConversationDetailView, "get_object", then_deleted)

    response = client().get(f"{URL}/{conversation.pk}")

    if deleted:
        assert (response.status_code, refused(response)) == (404, ("NOT_FOUND", {}))
    else:
        assert len(response.json()["messages"]) == 2


def test_reopening_costs_the_same_queries_for_thirty_exchanges() -> None:
    """The thread is read in one query and walked in memory, however long."""
    conversation = started(0)

    def queries() -> int:
        with CaptureQueriesContext(connection) as captured:
            client().get(f"{URL}/{conversation.pk}")
        return len(captured.captured_queries)

    one = queries()
    for minute in range(1, 30):
        turn(conversation, minute, [web()])

    assert queries() == one
    assert len(client().get(f"{URL}/{conversation.pk}").json()["messages"]) == 60


@pytest.mark.parametrize("address", ["not-a-uuid", "7"], ids=["text", "integer"])
def test_an_address_that_is_not_a_uuid_is_not_found(address: str) -> None:
    """It resolves to no view: the coded 404 of an address nothing serves."""
    started(0)

    response = client().get(f"{URL}/{address}")

    assert (response.status_code, refused(response)) == (404, ("NOT_FOUND", {}))


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_a_uuid_naming_nothing_is_not_found(method: str) -> None:
    started(0)

    response = getattr(client(), method)(f"{URL}/{uuid.uuid4()}", {"pinned": True}, format="json")

    assert (response.status_code, refused(response)) == (404, ("NOT_FOUND", {}))


@pytest.mark.parametrize("which", ["question", "answer"])
def test_no_message_is_deleted_on_its_own(which: str) -> None:
    """Its replies go with it, the leaf among them, so a deletion would leave a
    thread with no end and its rows read as nothing: it is refused, from a shell
    as from any other caller, and nothing is gone."""
    conversation = started(0)
    role = Message.Role.USER if which == "question" else Message.Role.ASSISTANT

    with pytest.raises(RestrictedError):
        Message.objects.filter(conversation=conversation, role=role).delete()

    assert len(client().get(f"{URL}/{conversation.pk}").json()["messages"]) == 2


def test_the_admin_refuses_to_delete_a_message_on_its_own(admin_client) -> None:
    """Its page names the conversation that stands in the way, and a confirmed
    deletion deletes nothing."""
    conversation = started(0)
    first = Message.objects.filter(conversation=conversation).first()
    assert first is not None
    url = reverse("admin:qa_message_delete", args=[first.pk])

    page = admin_client.get(url)
    confirmed = admin_client.post(url, {"post": "yes"})

    assert page.context["protected"]
    assert confirmed.status_code == 200
    assert Message.objects.filter(conversation=conversation).count() == 2


def test_the_admin_deletes_a_conversation_and_an_account_with_their_messages(
    admin_client,
) -> None:
    """A conversation that goes takes its leaf with it, so its messages are no
    longer held back: the refusal above is for a message alone."""
    conversation = started(0)
    stranger = User.objects.create_user(username="stranger")
    theirs = Conversation.objects.create(owner=stranger, locale="it")
    turn(theirs, 0, [web()])

    deleted = admin_client.post(
        reverse("admin:qa_conversation_delete", args=[conversation.pk]), {"post": "yes"}
    )
    removed = admin_client.post(
        reverse("admin:accounts_user_delete", args=[stranger.pk]), {"post": "yes"}
    )

    assert (deleted.status_code, removed.status_code) == (302, 302)
    assert not Conversation.objects.exists()
    assert not Message.objects.exists()
