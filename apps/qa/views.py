"""HTTP surface for question answering.

`POST /api/ask` replies with a stream of server-sent events (apps/qa/contract.py
owns their shape), and two endpoints act on an answer once it exists:
`GET /api/answers/<id>/events` reads its stream again, after a reload or a
dropped connection, and `POST /api/answers/<id>/stop` stops it. There is no
non-streaming form of the first. An answer takes tens of seconds to generate,
and a caller left holding an open socket in silence for all of them is the
problem this endpoint exists to remove — a second, buffered spelling of the
same call would only be a slower way to get the same bytes.

**This process answers nothing itself.** A question is admitted under the
global cap, queued for a worker (apps/qa/tasks.py), and the response relays
the answer's stream as the worker writes it (apps/qa/inflight.py). Nothing
here knows how routing, retrieval or generation work, and nothing here loads
a model.

**Where a status code stops being available.** Response headers leave with the
first byte of the body, and the body begins as soon as the question is queued:
its first event, `queued`, names the answer, which is what the stop button
needs, and the keepalives that follow it are how a reader who left is noticed
while the question still waits. So only what is decided before that is a
status code — a malformed question, the rate limit, a full cap — and
everything after it travels as an `error` event under a 200, an engine that is
down before the answer began included. Dify and OpenAI's background responses
name the answer in their stream's first event too (outside the repository).

**Leaving the page.** A signed-in student's answer is written to its end and
stored, whoever is still reading it. A visitor's is stored nowhere, so a
visitor who leaves stops it, and its place under the cap is free again.

**CSRF, for a caller with a session and for one without.** A logged-in request
is checked by the session authentication, the project-wide default
(apps/accounts/authentication.py), while it authenticates the caller. An anonymous one is
not, because that class checks only the callers it finds, so the permission
class below runs the same check for them (apps/accounts/permissions.py). The
browser sends the token as `X-CSRFToken`, the header Django's
`CSRF_HEADER_NAME` names by default, reading it from the cookie
`GET /api/auth/me` issues to anyone. Nothing about the stream is special here.

**Under WSGI an open stream holds a thread.** A synchronous iterator is
consumed on the thread that served the request, for as long as the answer is
being written, so a deployment sizes its threads for the streams open at once
(#41). The relay below touches no database, which is what would let it run
unchanged on ASGI's thread pool.
"""

from __future__ import annotations

import contextvars
import logging
import re
import time
import uuid
from typing import TYPE_CHECKING, Any, cast

from django.http import StreamingHttpResponse
from redis.exceptions import RedisError
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import AllowAnyWithCsrf
from apps.qa import inflight
from apps.qa.contract import KEEPALIVE, TERMINAL, ErrorEvent, QueuedEvent, sse, sse_event
from apps.qa.conversations import (
    ConversationGoneError,
    added_to,
    open_conversation,
    recent_turns,
)
from apps.qa.scope import boundary, search_scope
from apps.qa.serializers import AskRequest
from apps.qa.tasks import TIME_LIMIT_SECONDS, AnswerJob, enqueue
from config.errors import ErrorCode, error_body, fail
from config.request_id import current

if TYPE_CHECKING:
    from collections.abc import Generator, Mapping
    from uuid import UUID

    from rest_framework.request import Request

    from apps.accounts.models import User

logger = logging.getLogger(__name__)

# How long a question refused at the cap is told to wait (`UNAVAILABLE`). A
# place comes free when an answer ends, which takes tens of seconds, so a
# minute is long enough that a retry does not meet the same full cap. An
# outage (`ENGINE_DOWN`) names no wait: asking again will not end it.
RETRY_AFTER_SECONDS = 60

# The longest a relay waits on an answer: its wait for a worker, the longest
# the worker may take, and a margin. A worker that died is noticed long before
# (`inflight.probe`); this bounds a writer that holds its lease and writes
# nothing.
RELAY_LIMIT_SECONDS = inflight.QUEUED_LEASE_SECONDS + TIME_LIMIT_SECONDS + 30

# A stream entry's id, which is what `Last-Event-ID` sends back.
EVENT_ID = re.compile(r"\d+-\d+")


class ServerSentEventRenderer(BaseRenderer):
    """Present so that content negotiation can say yes to `text/event-stream`.

    DRF negotiates before the handler runs (`APIView.initial`), so without a
    renderer claiming this media type, a client that politely asks for the one
    thing this endpoint speaks is refused with a 406 by the endpoint that speaks
    it. The successful response is built below as a `StreamingHttpResponse` and
    never passes through a renderer at all; what reaches this one is only the
    error bodies (config/errors.py) — 400 from the serializer, 429 from the
    throttle, 503 from the cap — framed as the `error` event a failure inside
    the stream is.
    """

    media_type = "text/event-stream"
    format = "sse"
    charset = "utf-8"

    def render(
        self,
        data: Any,
        accepted_media_type: str | None = None,
        renderer_context: Mapping[str, Any] | None = None,
    ) -> str:
        # The JSON renderer the same body gets as `application/json`, so the
        # two framings carry the same bytes.
        return sse(ErrorEvent.NAME, JSONRenderer().render(data).decode())


class _Relay:
    """The response body: the answer's stream, read from Redis as the worker
    writes it, from the entry after `after` ("0" for the first).

    Not a generator, because Django calls `close()` on whatever it was handed
    once the request ends — a reader who navigates away is exactly that, a
    close arriving early — and closing a generator that was never iterated
    runs nothing. Closing is how a visitor's leaving stops their answer
    (`stops_on_leave`); a signed-in student's goes on.

    Between two events it waits on the stream. A wait that comes back empty
    sends a keepalive and asks whether the writer is alive
    (`inflight.probe`): a writer whose lease ran out, or a stream gone, ends
    the response with `ENGINE_DOWN`, as does an answer past the longest one
    may take, so that no response is held open for nothing. A lease that ran
    out before any worker took the question is, most often, a queue longer
    than the lease, and ends it with the `UNAVAILABLE` a full cap answers.

    It counts as one of the answer's readers (`inflight.MAX_READERS`) from
    its first event to its last. Pushed out by a newer one, it ends without a
    last event: a page still open reads that as a dropped connection and
    resumes (frontend/src/features/chat/follow.ts).

    Everything it runs, runs in a copy of the view's context. Under WSGI the
    body is read after the response has left the middleware, which has reset
    the request's id by then (config/request_id.py): without the copy, the
    lines the relay writes and the id its `error` event carries would name no
    request.
    """

    def __init__(self, answer_id: UUID, after: str, *, stops_on_leave: bool) -> None:
        self._answer_id = answer_id
        self._after = after
        self._stops_on_leave = stops_on_leave
        self._ended = False
        self._context = contextvars.copy_context()
        self._frames = self._framed()

    def __iter__(self) -> _Relay:
        return self

    def __next__(self) -> str:
        return self._context.run(next, self._frames)

    def _framed(self) -> Generator[str, None, None]:
        deadline = time.monotonic() + RELAY_LIMIT_SECONDS
        reader: inflight.Reader | None = None
        try:
            reader = inflight.join(self._answer_id)
            while True:
                entries = inflight.read(self._answer_id, self._after, reader=reader)
                for entry in entries:
                    self._after = entry.id
                    self._ended = entry.name in TERMINAL
                    yield sse(entry.name, entry.data, entry.id)
                    if self._ended:
                        return
                if entries:
                    continue
                state = inflight.probe(self._answer_id, self._after)
                if state == "more":
                    continue
                if state == "untaken":
                    logger.warning(
                        "answer %s waited out its lease before a worker took it: the site is"
                        " busy, or no worker consumes qa",
                        self._answer_id,
                    )
                    yield self._failed(
                        ErrorCode.UNAVAILABLE, retry_after_seconds=RETRY_AFTER_SECONDS
                    )
                    return
                if state != "alive":
                    logger.error("answer %s lost its writer (%s)", self._answer_id, state)
                elif time.monotonic() > deadline:
                    logger.error("answer %s passed the longest a relay waits", self._answer_id)
                else:
                    yield KEEPALIVE
                    continue
                yield self._failed(ErrorCode.ENGINE_DOWN)
                return
        except inflight.PushedOutError:
            return
        except RedisError:
            logger.exception("the stream of answer %s could not be read", self._answer_id)
            yield self._failed(ErrorCode.ENGINE_DOWN)
        finally:
            if reader is not None:
                try:
                    inflight.leave(self._answer_id, reader)
                except RedisError:
                    # Pushed out by the next reader's join all the same.
                    logger.exception("could not leave answer %s", self._answer_id)

    def _failed(self, code: ErrorCode, **data: int) -> str:
        self._ended = True
        return sse_event(ErrorEvent.model_validate(error_body(code, data)))

    def close(self) -> None:
        self._context.run(self._close)

    def _close(self) -> None:
        self._frames.close()
        if self._stops_on_leave and not self._ended:
            try:
                inflight.stop(self._answer_id)
            except RedisError:
                # Its lease ends in half a minute without a worker's renewal.
                logger.exception("could not stop answer %s", self._answer_id)


def _streaming(relay: _Relay) -> StreamingHttpResponse:
    return StreamingHttpResponse(
        relay,
        content_type="text/event-stream",
        headers={
            # An answer is not reusable, and anything that buffers this
            # response delivers it as one block at the end — precisely the
            # behaviour the stream exists to remove. nginx reads the second
            # header; where nothing proxies this, it costs nothing.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class AskView(APIView):
    """POST a question, read the answer as it is written.

    The reply is `text/event-stream`: one `queued` event naming the answer,
    one `start` event carrying the routing decision and the excerpts the
    answer will be grounded in, then one `token` event per piece of generated
    text, then `end`.

    Anyone may ask. A logged-in caller's question and answer are filed in a
    conversation, which supplies the next question's history, and the course
    material it searches is computed from the account (apps/qa/scope.py): its
    default, and the editions the conversation added. A question adding an
    edition outside the caller's boundary is refused before anything is
    stored, with one 403 whether the id names another programme's edition or
    none. An anonymous caller's are filed nowhere, the view making no query of
    its own, and its client sends the history back with each question
    instead; it is answered from the campus pages alone, never from course
    material.
    """

    # A tuple because ruff's RUF012 objects to a mutable class attribute, and
    # DRF only iterates this. JSON first so that a client with no preference —
    # `Accept: */*`, which is what curl sends — gets plain JSON for the error
    # bodies; the SSE framing is for whoever explicitly asked for the stream.
    renderer_classes = (JSONRenderer, ServerSentEventRenderer)
    permission_classes = (AllowAnyWithCsrf,)

    # Its own bucket, separate from the login endpoints': what limits this one
    # is the questions a minute the workers can answer, and what limits those
    # is how fast a password can be guessed. A single rate covering both would
    # be wrong for whichever it was not chosen for (config/settings.py). The
    # scoped throttle counts a logged-in caller by account and an anonymous one
    # by address, so a campus behind one NAT shares one anonymous budget
    # (docs/security.md).
    throttle_scope = "ask"

    def post(self, request: Request) -> StreamingHttpResponse:
        payload = AskRequest(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        validated = payload.validated_data

        added = validated["added_editions"]
        if request.user.is_authenticated:
            # The cast is the one apps/accounts/views.py explains: pyright has
            # no django-stubs plugin, so `request.user` is the abstract base to it.
            user = cast("User", request.user)
            editions = list(boundary(user))
            if added is not None and not set(added) <= {edition.pk for edition in editions}:
                fail(ErrorCode.PERMISSION_DENIED)
            stored = validated["conversation"]
            conversation = open_conversation(user, stored)
            try:
                history = recent_turns(conversation)
            # Deleted after the serializer found it: the refusal of an unknown
            # id (apps/qa/serializers.py), one error, whenever it is found.
            except ConversationGoneError:
                fail(ErrorCode.CONVERSATION_GONE)
            owner, conversation_id = user.pk, conversation.pk
            # What the question names, or else what the conversation holds: a
            # new one holds nothing, and costs no query to say so.
            if added is not None:
                searched = set(added)
            elif stored is not None:
                searched = added_to(stored)
            else:
                searched = set()
            scope = search_scope(editions, searched)
        else:
            history = validated["history"]
            owner, conversation_id = None, None
            # No edition: course material is for students with an account, and
            # an empty scope skips the slides collection without querying it.
            scope = []

        answer_id = uuid.uuid4()
        job = AnswerJob(
            answer_id=answer_id,
            question=validated["question"],
            locale=validated["locale"],
            history=history,
            scope=scope,
            added_editions=added,
            conversation_id=conversation_id,
            asked_at=time.time(),
            request_id=current(),
        )
        queued = QueuedEvent(
            answer_id=answer_id, conversation_id=conversation_id, question=job.question
        )
        if not inflight.admit(answer_id, queued, owner=owner, conversation_id=conversation_id):
            fail(ErrorCode.UNAVAILABLE, retry_after_seconds=RETRY_AFTER_SECONDS)
        try:
            enqueue(job)
        except Exception:
            # The broker is down: the question never reached a queue, so it
            # gives its place back and leaves no stream for anyone to wait on.
            inflight.abandon(answer_id, conversation_id=conversation_id)
            raise
        return _streaming(_Relay(answer_id, "0", stops_on_leave=owner is None))


class AnswerEventsView(APIView):
    """GET an answer's events again: after a reload, or after the connection
    dropped.

    For the signed-in student who asked it only. A visitor's answer is stored
    nowhere and stops when they leave, so there is nothing to come back to.
    `Last-Event-ID`, the header the SSE standard names for this, resumes after
    the event it names; without it, the stream is read from its start, which
    is what a reloaded page needs. A stream that is gone, or someone else's, is
    the 404 of an answer that does not exist: whose answers exist is not
    something to learn by asking.
    """

    renderer_classes = (JSONRenderer, ServerSentEventRenderer)
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, pk: UUID) -> StreamingHttpResponse:
        if inflight.owner(pk) != str(request.user.pk):
            fail(ErrorCode.NOT_FOUND)
        after = request.headers.get("Last-Event-ID")
        if after is not None and not EVENT_ID.fullmatch(after):
            fail(ErrorCode.MALFORMED_REQUEST)
        return _streaming(_Relay(pk, after or "0", stops_on_leave=False))


class StopAnswerView(APIView):
    """POST to stop an answer being written: 204, and 204 again for one that
    already stopped or ended, as OpenAI's cancel of a background response is
    safe to repeat (outside the repository).

    A signed-in student's answer is stopped by the student who asked, nobody
    else. A visitor's is stopped by whoever holds its id: the id travels only
    in the asker's own stream, and nothing of the answer is stored where
    another caller could reach it, so knowing the id is the credential. The
    worker notices within a second and keeps what it wrote (apps/qa/tasks.py).
    """

    permission_classes = (AllowAnyWithCsrf,)

    def post(self, request: Request, pk: UUID) -> Response:
        owner = inflight.owner(pk)
        if owner is None or owner not in ("", str(request.user.pk)):
            fail(ErrorCode.NOT_FOUND)
        inflight.stop(pk)
        return Response(status=204)
