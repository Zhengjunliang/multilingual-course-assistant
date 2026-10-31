"""Langfuse as a projection of this database: an answer's trace goes with its
conversation, and a rating is a score on the trace of the answer it rates.

The worker that answers writes the traces (apps/qa/tasks.py); this module
keeps them in step with the rows, and the rows are the side that is right.
Two tasks follow a change at once, so that it shows in Langfuse while one
looks: `forget_traces` deletes the traces of a conversation's answers, queued
by the conversation's `pre_delete`, which its own deletion, its owner's and
the admin's all send; `sync_feedback_score` writes or deletes a rating's
score, queued by the view that changed it (apps/qa/feedback_views.py).

Neither is what the projection rests on: a task runs while Langfuse is down,
and none is queued while tracing is off. `reconcile_traces`, every ten
minutes from beat, compares the two sides whole and corrects Langfuse: the
traces of conversations that are gone, the one exported late, after its
conversation was deleted mid-answer, and every score. It lists everything
each time, which the thesis's few thousand traces afford; past that, it
would list what changed since its last run.

A score is named after its answer and dated by it, so writing it again
replaces it rather than adding a second: Langfuse keeps a score under its
id and its date, and a rating withdrawn and given again is a row with
another date. Only an answer with a trace gets a score; one asked while
tracing was off has none, and never will.

Only the worker talks to Langfuse: the web process queues the tasks and never
imports `langfuse` (rag/llm.py). With tracing off nothing is queued, and a
task that runs returns at once.
"""

from __future__ import annotations

import logging
from functools import partial
from typing import TYPE_CHECKING, Any, cast
from uuid import UUID

import httpx
from django.db import transaction
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from apps.qa.models import Conversation, Feedback, Message
from config.celery import app
from config.env import env

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from celery import Task
    from langfuse import Langfuse

logger = logging.getLogger(__name__)

# The name of a site answer's trace (apps/qa/tasks.py), which tells it from a
# CLI run's, `routing` or `agent` (rag/gold.py, rag/agent.py): a run belongs
# to no conversation, and this module never touches one.
SITE_TRACE = "question"

# A rating's score, by the name Langfuse's own guide gives user feedback
# (outside the repository): 1 for a thumb up, 0 for a thumb down.
SCORE = "user-feedback"


def score_id(answer_id: UUID) -> str:
    return f"feedback-{answer_id}"


def _queue(task: object, *args: object) -> None:
    # Celery leaves `app.task` unannotated, so pyright sees the bare function.
    cast("Task", task).delay(*args)


@receiver(pre_delete, sender=Conversation)
def _forget_with_its_conversation(
    sender: type[Conversation], instance: Conversation, **_kwargs: object
) -> None:
    """Queue the deletion of the answers' traces once the conversation is gone.

    Sent for every conversation a deletion takes, an account's included, so
    the ids are read here, while its answers are still there. Robust: a
    broker that refuses the task cannot undo a deletion already committed,
    and the next reconciliation deletes the traces all the same.
    """
    if not env.langfuse_tracing_enabled:
        return
    trace_ids = list(
        Message.objects.filter(conversation=instance, role=Message.Role.ASSISTANT)
        .exclude(request_id="")
        .values_list("request_id", flat=True)
    )
    if trace_ids:
        transaction.on_commit(partial(_queue, forget_traces, trace_ids), robust=True)


def rating_changed(answer_id: UUID) -> None:
    """Queue the score of `answer_id`'s rating, as it stands once committed."""
    if env.langfuse_tracing_enabled:
        transaction.on_commit(partial(_queue, sync_feedback_score, str(answer_id)), robust=True)


def _reaching(work: Callable[[Langfuse], object]) -> None:
    """Run `work` against Langfuse, and with tracing off not at all.

    Langfuse out of reach is a line in the log rather than a traceback every
    ten minutes: what this run missed, the next reconciliation does.
    """
    from rag.llm import tracer

    client = tracer()
    if client is None:
        return
    try:
        work(client)
    except httpx.TransportError as exc:
        logger.warning("Langfuse did not respond (%s); the next reconciliation catches up", exc)


def _every(get_many: Callable[..., Any], **query: object) -> Iterator[Any]:
    """Every row a Langfuse list holds, page after page, by its cursor."""
    cursor = None
    while True:
        page = get_many(cursor=cursor, **query)
        yield from page.data
        cursor = page.meta.cursor
        if not cursor:
            return


def _up(rating: Feedback) -> bool:
    return rating.rating == Feedback.Rating.UP


def _comment(rating: Feedback) -> str | None:
    """Why a thumb down was given, the reason's key before the comment."""
    return ": ".join(part for part in (rating.reason, rating.comment) if part) or None


def _send(client: Langfuse, rating: Feedback) -> None:
    client.create_score(
        name=SCORE,
        value=1.0 if _up(rating) else 0.0,
        data_type="BOOLEAN",
        trace_id=rating.answer.request_id,
        score_id=score_id(rating.answer_id),
        comment=_comment(rating),
        timestamp=rating.answer.created_at,
    )


def _sync_score(client: Langfuse, answer_id: UUID) -> None:
    rating = Feedback.objects.select_related("answer").filter(answer_id=answer_id).first()
    if rating is None:
        # Withdrawn, or gone with its conversation; deleting a score Langfuse
        # does not hold is no error.
        client.api.scores.delete(score_id(answer_id))
        return
    request_id = rating.answer.request_id
    # An answer with no trace yet, exported late, is scored by the next
    # reconciliation; one asked while tracing was off, never.
    if (
        not request_id
        or not client.api.observations.get_many(
            trace_id=request_id, name=SITE_TRACE, is_root_observation=True, fields="core", limit=1
        ).data
    ):
        return
    _send(client, rating)
    client.flush()


def _reconcile(client: Langfuse) -> None:
    sessions = {
        root.trace_id: root.session_id
        for root in _every(
            client.api.observations.get_many,
            name=SITE_TRACE,
            is_root_observation=True,
            fields="basic",
            limit=1000,
        )
        # A trace with no session is no site answer's, whatever its name.
        if root.trace_id and root.session_id
    }
    ids: set[UUID] = set()
    for session in set(sessions.values()):
        try:
            ids.add(UUID(session))
        except ValueError:
            continue
    live = {str(pk) for pk in Conversation.objects.filter(pk__in=ids).values_list("pk", flat=True)}
    gone = [trace_id for trace_id, session in sessions.items() if session not in live]
    if gone:
        client.api.trace.delete_multiple(trace_ids=gone)

    kept = sessions.keys() - set(gone)
    wanted = {
        score_id(rating.answer_id): rating
        for rating in Feedback.objects.select_related("answer").filter(answer__request_id__in=kept)
    }
    for score in _every(
        client.api.scores.get_many,
        name=SCORE,
        source="API",
        data_type="BOOLEAN",
        fields="details",
        limit=100,
    ):
        rating = wanted.pop(score.id, None)
        if rating is None:
            client.api.scores.delete(score.id)
        elif (score.value, score.comment) != (_up(rating), _comment(rating)):
            _send(client, rating)
    for rating in wanted.values():
        _send(client, rating)
    client.flush()


@app.task
def reconcile_traces() -> None:
    """Correct Langfuse to the database (the module docstring)."""
    _reaching(_reconcile)


@app.task
def forget_traces(trace_ids: list[str]) -> None:
    """Delete these traces, with their scores; Langfuse does it within minutes."""
    _reaching(lambda client: client.api.trace.delete_multiple(trace_ids=trace_ids))


@app.task
def sync_feedback_score(answer_id: str) -> None:
    """Write the score of this answer's rating, or delete it once the rating is gone."""
    _reaching(partial(_sync_score, answer_id=UUID(answer_id)))
