"""Reading and writing a conversation around one answered question.

Every query the answer path makes is in this module, and it makes them for one
reason each: find or start the thread, slice the history the prompt gets, write
the two rows, settle the assistant row when the stream ends. `thread` is how a
conversation is read in order, here and in the detail the sidebar opens. HTTP is not
mentioned here and neither is the engine — the view calls these in order, and
what crosses into `rag/` is `Turn`, two strings on a frozen model.

**Where the writes happen matters more than what they write.** Both rows are
created after the engine's first event has been pulled, never before. Until that
`next()` returns, the question can still fail into a 503 — a stopped model
server, a stopped Qdrant service — and a question that was refused
before it was ever asked should leave nothing behind. Created earlier, every
503 would deposit a question with no answer under it, and the next turn's
history would be built around the hole.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import transaction

from apps.qa.models import HISTORY_WINDOW_TURNS, Conversation, Message
from rag.answer import Turn

if TYPE_CHECKING:
    from collections.abc import Iterable
    from uuid import UUID

    from apps.accounts.models import User
    from apps.qa.contract import StartEvent


class ConversationGoneError(Exception):
    """The conversation was deleted while it was being read, or while its
    question waited for the engine."""


class BrokenThreadError(Exception):
    """A conversation's chain of parents does not lead from its leaf to a root.

    Only `record_exchange` writes the chain, so this is a defect or a row
    changed by hand, never something a reader did: it is left to surface as a
    500, which the error handler logs (config/errors.py).
    """


def thread(leaf_id: UUID | None, messages: Iterable[Message]) -> list[Message]:
    """The path from the root to `leaf_id` among `messages`, oldest first.

    `messages` is every row of one conversation, read in one query, and the
    walk follows `parent_id` through a dict, so it costs no query per step. A
    conversation holds tens of rows, which is what makes walking them in Python
    the simple choice; one holding thousands would take a recursive query.

    No leaf is a conversation nothing has been written to: an empty thread. A
    leaf with no messages at all is a conversation deleted between the query
    that read its row and the one that read its messages, so
    `ConversationGoneError`. Anything else that does not lead back to a root —
    a parent missing from `messages`, or a cycle — is `BrokenThreadError`.
    """
    if leaf_id is None:
        return []
    by_id = {message.pk: message for message in messages}
    if not by_id:
        raise ConversationGoneError(leaf_id)
    path: list[Message] = []
    node: UUID | None = leaf_id
    while node is not None:
        # Popped, so a row met twice — a cycle — is missing the second time.
        message = by_id.pop(node, None)
        if message is None:
            raise BrokenThreadError(node)
        path.append(message)
        node = message.parent_id
    path.reverse()
    return path


def open_conversation(owner: User, existing: Conversation | None) -> Conversation:
    """The thread this question belongs to, started if it does not exist yet.

    `existing` has already been proved to belong to `owner` — that check is
    validation, so it lives in the serializer where it can produce a 400
    (apps/qa/serializers.py). What is left here is the other half: no id means a
    new thread, and a new thread inherits the account's language.

    This runs before the engine does, and it has to: the `start` event carries
    the id, so the id must exist before there is an event to put it in. A
    question that then fails into a 503 therefore leaves an empty conversation
    behind. It is never listed — apps/qa/conversation_views.py excludes threads
    with no messages — which is cheaper and more honest than a delete on every
    outage.
    """
    if existing is not None:
        return existing
    return Conversation.objects.create(owner=owner, locale=owner.locale)


def recent_turns(conversation: Conversation) -> list[Turn]:
    """The last few completed exchanges of the thread, oldest first.

    The thread ends at the leaf `conversation` was read with, so the history is
    the conversation as the question's sender last saw it.

    An unfinished answer is included deliberately. It is what the student
    actually saw — a stream that died halfway is still on their screen — so
    leaving it out would build the next prompt around a conversation that did
    not happen.

    The pairing loop does not assume the rows arrive in pairs even though they
    are written that way: a user row whose answer never existed is skipped
    rather than paired with the next answer, which belongs to a different
    question.
    """
    recent = thread(
        conversation.current_leaf_id, Message.objects.filter(conversation=conversation)
    )[-HISTORY_WINDOW_TURNS * 2 :]

    turns: list[Turn] = []
    asked: Message | None = None
    for message in recent:
        if message.role == Message.Role.USER:
            asked = message
        elif asked is not None:
            turns.append(Turn(question=asked.text, answer=message.text))
            asked = None
    return turns


def record_exchange(conversation: Conversation, start: StartEvent) -> UUID:
    """Write the question and the empty answer; return the answer row's id.

    Only the id travels onward. The stream that fills the row in runs for tens
    of seconds, and a model instance held across it would be a snapshot going
    steadily more stale — `settle` writes by primary key for that reason.

    The question hangs from the leaf the locked row holds, not the one
    `conversation` was read with: a question that waited for the engine holds
    a copy older than an exchange another tab wrote meanwhile, and hung from
    that copy's leaf it would fork the thread. The answer hangs from the
    question and becomes the leaf, in the same lock, so every parent is a row
    of the same conversation.

    `citations`, `route` and `search_ms` are stored now rather than at the end
    because now is when they exist: they arrive in the `start` event, which is
    not repeated. Reopening this conversation later replays it from these
    columns.

    The question may have waited up to the queue timeout for the engine, and
    the student may have deleted the conversation meanwhile — after Stop, or
    from another tab. The row lock is the one the delete takes
    (apps/qa/conversation_views.py): taken after the delete, the conversation
    is gone and `ConversationGoneError` is raised before anything is written;
    taken before it, the two rows are written and the delete, which waits,
    removes them with the conversation.
    """
    with transaction.atomic():
        locked = Conversation.objects.select_for_update().filter(pk=conversation.pk).first()
        if locked is None:
            raise ConversationGoneError(conversation.pk)
        question = Message.objects.create(
            conversation=conversation,
            parent_id=locked.current_leaf_id,
            role=Message.Role.USER,
            text=start.question,
            locale=start.locale,
            complete=True,
        )
        answer = Message.objects.create(
            conversation=conversation,
            parent=question,
            role=Message.Role.ASSISTANT,
            text="",
            locale=start.locale,
            complete=False,
            citations=[citation.model_dump(mode="json") for citation in start.citations],
            route=start.route.model_dump(mode="json"),
            search_ms=start.search_ms,
        )
        Conversation.objects.filter(pk=conversation.pk).update(current_leaf=answer)
    return answer.pk


def settle(answer_pk: UUID, text: str, *, complete: bool) -> None:
    """Fill in the answer row once the stream has stopped, however it stopped."""
    Message.objects.filter(pk=answer_pk).update(text=text, complete=complete)
