"""Reading and writing a conversation around one answered question.

Every query the answer path makes is in this module, and it makes them for one
reason each: find or start the thread, slice the history the prompt gets, write
the two rows, settle the assistant row when the stream ends. HTTP is not
mentioned here and neither is the engine — the view calls these in order, and
what crosses into `rag/` is `Turn`, two strings on a frozen model.

**Where the writes happen matters more than what they write.** Both rows are
created after the engine's first event has been pulled, never before. Until that
`next()` returns, the question can still fail into a 503 — a stopped model
server, an index another process is holding — and a question that was refused
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
    from apps.accounts.models import User
    from apps.qa.contract import StartEvent


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
    """The last few completed exchanges, oldest first.

    An unfinished answer is included deliberately. It is what the student
    actually saw — a stream that died halfway is still on their screen — so
    leaving it out would build the next prompt around a conversation that did
    not happen.

    The pairing loop does not assume the rows arrive in pairs even though they
    are written that way: a user row whose answer never existed is skipped
    rather than paired with the next answer, which belongs to a different
    question.
    """
    recent = list(
        Message.objects.filter(conversation=conversation).order_by("-created_at", "-id")[
            : HISTORY_WINDOW_TURNS * 2
        ]
    )
    recent.reverse()

    turns: list[Turn] = []
    asked: Message | None = None
    for message in recent:
        if message.role == Message.Role.USER:
            asked = message
        elif asked is not None:
            turns.append(Turn(question=asked.text, answer=message.text))
            asked = None
    return turns


def record_exchange(conversation: Conversation, start: StartEvent) -> int:
    """Write the question and the empty answer; return the answer row's id.

    Only the id travels onward. The stream that fills the row in runs for tens
    of seconds, and a model instance held across it would be a snapshot going
    steadily more stale — `settle` writes by primary key for that reason.

    `citations` and `route` are stored now rather than at the end because now is
    when they exist: they arrive in the `start` event, which is not repeated.
    Reopening this conversation later replays it from these columns.
    """
    with transaction.atomic():
        Message.objects.create(
            conversation=conversation,
            role=Message.Role.USER,
            text=start.question,
            locale=start.locale,
            complete=True,
        )
        answer = Message.objects.create(
            conversation=conversation,
            role=Message.Role.ASSISTANT,
            text="",
            locale=start.locale,
            complete=False,
            citations=[citation.model_dump(mode="json") for citation in start.citations],
            route=start.route.model_dump(mode="json"),
        )
    return answer.pk


def settle(answer_pk: int, text: str, *, complete: bool) -> None:
    """Fill in the answer row once the stream has stopped, however it stopped."""
    Message.objects.filter(pk=answer_pk).update(text=text, complete=complete)
