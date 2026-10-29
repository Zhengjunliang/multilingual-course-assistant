"""Question answering's background task: one question, answered on a worker.

The web process admits a question under the global cap, queues this task on
`qa` and relays to the browser what it writes (apps/qa/views.py). This is
the other half, and it owns three things:

- the conversation's rows, written once `start` exists and settled once the
  answer ends (apps/qa/conversations.py), so a signed-in student who leaves
  the page still finds the answer when they come back;
- the answer's events, written into its stream (apps/qa/inflight.py);
- its lease, renewed every second by a heartbeat thread, which is also how a
  stop reaches it.

**Answered once.** The task is acknowledged as it starts, against the late
acknowledgement every other task here has (config/settings.py): a question
whose worker died is not worth answering an hour later, when the broker
would deliver it again, since its reader was told it failed long before. A
worker that takes it late anyway finds its lease gone and drops it.

**Its own time limit.** Celery enforces time limits only on the prefork
pool, and this task runs on the threads pool, or on solo on a Windows
worker, so it checks the time itself between two events.
"""

from __future__ import annotations

import contextvars
import logging
import threading
import time
from contextlib import closing
from typing import TYPE_CHECKING, cast
from uuid import UUID

from celery.signals import worker_ready
from pydantic import BaseModel, ConfigDict
from redis.exceptions import RedisError

from apps.qa import inflight
from apps.qa.contract import EndEvent, ErrorEvent, StartEvent, StoppedEvent, TokenEvent
from apps.qa.conversations import ConversationGoneError, record_exchange, settle
from apps.qa.engine import EngineUnavailableError, loaded_engine
from config.celery import app
from config.errors import ErrorCode, error_body
from config.request_id import serving
from rag.answer import Turn
from rag.chunk import EditionKey

if TYPE_CHECKING:
    from types import TracebackType

    from celery import Task

    from apps.qa.contract import Event

logger = logging.getLogger(__name__)

# The longest an answer may take once a worker has taken it: the soft limit
# every other task has (config/settings.py). An answer takes tens of seconds,
# and the model server's own requests time out after 30 (rag/llm.py).
TIME_LIMIT_SECONDS = 5 * 60

# How often the heartbeat renews the lease and looks for a stop. Dify looks
# for its stop flag once a second too (outside the repository).
HEARTBEAT_SECONDS = 1.0


class AnswerJob(BaseModel):
    """What the web process hands the worker: everything the answer needs, so
    that the worker looks nothing up before it starts. It crosses the broker
    as JSON, the only serialisation this project's Celery accepts.

    `conversation_id` is None for an anonymous question, whose answer is
    stored nowhere. `asked_at` is when the question was admitted, wall-clock
    time since it is read in another process (`StartEvent.search_ms`), and
    `request_id` the id of the request that asked, under which the task logs
    and reports its failures (config/request_id.py).
    """

    model_config = ConfigDict(frozen=True)

    answer_id: UUID
    question: str
    locale: str | None
    history: list[Turn]
    scope: list[EditionKey] | None
    conversation_id: UUID | None
    asked_at: float
    request_id: str


def enqueue(job: AnswerJob) -> None:
    """Queue `job` on `qa`, under the answer's id as the task's."""
    # Celery leaves `app.task` unannotated, so pyright sees the bare function.
    task = cast("Task", answer_question)
    task.apply_async((job.model_dump(mode="json"),), task_id=str(job.answer_id))


@app.task(queue="qa", acks_late=False, ignore_result=True)
def answer_question(payload: dict[str, object]) -> None:
    """Answer one question: the engine's events into the answer's stream."""
    job = AnswerJob.model_validate(payload)
    with serving(job.request_id):
        verdict = inflight.renew(job.answer_id)
        if verdict == "lost":
            # Its reader has been told it died (apps/qa/views.py).
            logger.warning("answer %s was taken after its lease ran out", job.answer_id)
            inflight.finish(job.answer_id, None, conversation_id=job.conversation_id)
            return
        if verdict == "stopped":
            inflight.finish(job.answer_id, StoppedEvent(), conversation_id=job.conversation_id)
            return
        with _Heartbeat(job.answer_id) as heartbeat:
            last = _generate(job, heartbeat)
        inflight.finish(job.answer_id, last, conversation_id=job.conversation_id)


class _Heartbeat:
    """Renews an answer's lease every second, on a thread of its own, and
    keeps the reason it stopped: `stopped` or `lost`, `ok` while it goes on.

    A thread rather than a renewal between two events, because there are
    long stretches with no event: the engine's first build, the router's
    reply, the wait for the GPU behind another answer's retrieval.
    """

    def __init__(self, answer_id: UUID) -> None:
        self._answer_id = answer_id
        self._done = threading.Event()
        self.verdict: inflight.Renewal = "ok"
        # In a copy of the task's context, so its log lines carry the request's id.
        context = contextvars.copy_context()
        self._thread = threading.Thread(target=context.run, args=(self._run,), daemon=True)

    def __enter__(self) -> _Heartbeat:
        self._thread.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._done.set()
        self._thread.join()

    def _run(self) -> None:
        while not self._done.wait(HEARTBEAT_SECONDS):
            try:
                verdict = inflight.renew(self._answer_id)
            except RedisError:
                # The lease has thirty seconds; the next beat tries again.
                logger.exception("could not renew the lease of answer %s", self._answer_id)
                continue
            if verdict != "ok":
                self.verdict = verdict
                return


def _generate(job: AnswerJob, heartbeat: _Heartbeat) -> Event:
    """Run the engine and write what it yields; return the event that ends the
    answer, which the caller writes once the rows are settled.

    That order is the reason this returns the last event rather than writing
    it: a reader who receives `end` and reopens the conversation at once finds
    the answer whole.

    The rows are written only once `start` exists, and only if no stop arrived
    meanwhile: asked once more rather than read off the heartbeat, whose
    verdict may be a second old. So a question that fails, or is stopped,
    before its answer began leaves nothing behind (apps/qa/conversations.py).
    Closing the engine's generator, on every way out, is what stops pulling
    tokens from a model nobody is listening to any more.
    """
    deadline = time.monotonic() + TIME_LIMIT_SECONDS
    parts: list[str] = []
    stored = False
    complete = False
    try:
        events = loaded_engine().stream(
            job.question,
            job.conversation_id,
            job.locale,
            job.history,
            scope=job.scope,
            asked_at=job.asked_at,
        )
        with closing(events):
            start = cast("StartEvent", next(events))
            verdict = inflight.renew(job.answer_id)
            if verdict != "ok":
                return _halted(job, verdict)
            if job.conversation_id is not None:
                record_exchange(job.conversation_id, start, job.answer_id)
                stored = True
            inflight.emit(job.answer_id, start)
            for event in events:
                if heartbeat.verdict != "ok":
                    return _halted(job, heartbeat.verdict)
                if time.monotonic() > deadline:
                    logger.error("answer %s passed its time limit", job.answer_id)
                    return _failure(ErrorCode.ENGINE_DOWN)
                if isinstance(event, EndEvent):
                    complete = True
                    return event
                parts.append(cast("TokenEvent", event).text)
                inflight.emit(job.answer_id, event)
        # The engine ends every answer with `end`.
        logger.error("answer %s ended without its end event", job.answer_id)
        return _failure(ErrorCode.INTERNAL)
    except ConversationGoneError:
        # Deleted while the question waited: the student's own doing, no defect.
        logger.warning("answer %s: its conversation was deleted meanwhile", job.answer_id)
        return _failure(ErrorCode.CONVERSATION_GONE)
    except Exception as exc:
        # An outage or a defect, logged once with its traceback: an outage's
        # message names what is down and how to start it (#14).
        outage = isinstance(exc, EngineUnavailableError)
        failure = _failure(ErrorCode.ENGINE_DOWN if outage else ErrorCode.INTERNAL)
        logger.exception("the stream ended in %s: %s", failure.error.code, failure.error.message)
        return failure
    finally:
        if stored:
            try:
                settle(job.answer_id, "".join(parts), complete=complete)
            except Exception:
                logger.exception("could not settle answer %s", job.answer_id)


def _halted(job: AnswerJob, verdict: inflight.Renewal) -> Event:
    if verdict == "stopped":
        return StoppedEvent()
    logger.error("answer %s lost its lease while it was written", job.answer_id)
    return _failure(ErrorCode.ENGINE_DOWN)


def _failure(code: ErrorCode) -> ErrorEvent:
    """The `error` event for `code`, under the asking request's id."""
    return ErrorEvent.model_validate(error_body(code))


@worker_ready.connect
def _load_the_models(sender: object, **_kwargs: object) -> None:
    """Load the engine as soon as a worker that answers questions is up, so
    the first question does not wait a minute for the models. A worker that
    consumes `default` alone loads nothing. A failure leaves the slot empty,
    and the first question tries again (`loaded_engine`)."""
    if "qa" not in app.amqp.queues.consume_from:
        return
    try:
        loaded_engine()
    except EngineUnavailableError:
        logger.exception("the engine could not be loaded; the first question will try again")
