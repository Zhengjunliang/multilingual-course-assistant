"""HTTP surface for question answering.

One endpoint, one method, one media type: `POST /api/ask` replies with a stream
of server-sent events (apps/qa/contract.py owns their shape). There is no
non-streaming form of it. An answer takes tens of seconds to generate, and a
caller left holding an open socket in silence for all of them is the problem
this endpoint exists to remove — a second, buffered spelling of the same call
would only be a slower way to get the same bytes.

The view's whole job is translation: a validated request in, an event stream
out. Nothing here knows how routing, retrieval or generation work.

**Where a status code stops being available.** Response headers leave with the
first byte of the body, so only a failure that happens before the first event
can still be a 503. That is why the engine's generator is primed here rather
than handed straight to Django: the first `next()` is what runs routing and
retrieval, and until it returns nothing has been sent. Everything after it — a
model server that dies halfway through an answer — travels as an `error` event
under a 200 that was already committed.

**CSRF, and why this file does nothing about it.** That debt is paid, and it
was paid in configuration rather than here: `SessionAuthentication` plus
`IsAuthenticated` are the project-wide defaults (config/settings.py), so a
request that reaches this view carries a session cookie and DRF has already
enforced the token against it. The browser sends that token as `X-CSRFToken`,
the header DRF's `CSRF_HEADER_NAME` names by default, reading it from the cookie
`GET /api/auth/me` issues. Nothing about the stream is special here; it is the
same rule every endpoint follows.

**WSGI is a load-bearing assumption, and this is the file it bears on.** Under
`WSGI_APPLICATION` a synchronous iterator is consumed on the thread that served
the request, so the response body, the queue lock it holds and the database
connection it writes through all belong to one thread. Django runs a
synchronous `StreamingHttpResponse` iterator in a thread pool under ASGI
instead — and its database connections are thread-local, so the settling write
below would open a connection on a pool thread that `close_old_connections`
never reaches. That is one leaked connection per answered question. Moving this
project to ASGI starts here.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Literal, cast

from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.qa.contract import (
    EndEvent,
    ErrorEvent,
    StartEvent,
    TokenEvent,
    Unavailable,
    sse,
    sse_event,
)
from apps.qa.conversations import open_conversation, recent_turns, record_exchange, settle
from apps.qa.engine import EngineBusyError, EngineUnavailableError, stream_answer
from apps.qa.serializers import AskRequest

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator, Mapping

    from rest_framework.request import Request

    from apps.accounts.models import User
    from apps.qa.contract import Event

logger = logging.getLogger(__name__)

# Every 503 here is transient by construction: a stopped model server, an index
# another process is holding, a question still being answered. A minute is long
# enough that a retry is not simply requeued behind the same work.
RETRY_AFTER_SECONDS = 60


class ServerSentEventRenderer(BaseRenderer):
    """Present so that content negotiation can say yes to `text/event-stream`.

    DRF negotiates before the handler runs (`APIView.initial`), so without a
    renderer claiming this media type, a client that politely asks for the one
    thing this endpoint speaks is refused with a 406 by the endpoint that speaks
    it. The successful response is built below as a `StreamingHttpResponse` and
    never passes through a renderer at all; what reaches this one is only DRF's
    error bodies — 400 from the serializer, 429 from the throttle, 503 from the
    engine — which keep their own shape inside the framing the caller asked for.
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
        # DRF's own JSON renderer rather than `json.dumps`: those bodies are
        # full of `ErrorDetail` and lazy translation proxies, which it knows how
        # to serialise and the standard library does not.
        return sse(ErrorEvent.NAME, JSONRenderer().render(data).decode())


class _EventStream:
    """The response body — and the one thing here that must not be a generator.

    Django calls `close()` on whatever it was handed once the request ends, and
    a reader who navigates away is exactly that: a close, arriving early. `rest`
    is where the queue lock is released, so that close has to reach it.

    A generator would not deliver it. Closing one that was never iterated does
    nothing at all — its body never ran, so it has no `finally` to run — while
    `rest` has already been primed by the view and is holding the lock by then.
    A client that hangs up before reading a single byte would strand it, and
    every later question with it. A class closes `rest` unconditionally.

    Closing `rest` is also what stops generation: it is suspended on a `yield`
    inside `rag.answer`, so a reader who leaves takes the model with them
    instead of leaving it writing for nobody.

    It is also where the answer is saved, because this object is the only thing
    that sees every way a stream can stop: an `end` event, an `error` event in
    its place, or a reader who left. All three settle the row — what differs is
    only whether the text in it is complete.
    """

    def __init__(self, first: Event, rest: Generator[Event, None, None], answer_pk: int) -> None:
        self._first = first
        self._rest = rest
        self._answer_pk = answer_pk
        self._parts: list[str] = []
        self._settled = False

    def __iter__(self) -> Iterator[str]:
        yield sse_event(self._first)
        complete = False
        for event in self._rest:
            if isinstance(event, TokenEvent):
                self._parts.append(event.text)
            elif isinstance(event, EndEvent):
                complete = True
            yield sse_event(event)
        # Reached only when `rest` ran out, which means its `finally` has already
        # returned the queue lock. Settling before this point would put a
        # database round trip inside everyone else's wait.
        self._settle(complete=complete)

    def close(self) -> None:
        # Same ordering, same reason, and here it is the expensive case: `rest`
        # is suspended mid-answer and still holding the lock, so it is closed
        # first and written about second.
        self._rest.close()
        self._settle(complete=False)

    def _settle(self, *, complete: bool) -> None:
        """Once, whichever of the three endings arrives first.

        Django calls `close()` on every response, including one that finished
        normally, so without the guard a completed answer would be marked
        incomplete a moment after being marked complete.

        A failure here is logged rather than raised: this runs while the
        response is being closed, and an exception escaping that path replaces
        an answer the reader already has with a traceback.
        """
        if self._settled:
            return
        self._settled = True
        try:
            settle(self._answer_pk, "".join(self._parts), complete=complete)
        except Exception:
            logger.exception("could not settle answer %s", self._answer_pk)


class AskView(APIView):
    """POST a question, read the answer as it is written.

    The reply is `text/event-stream`: one `start` event carrying the routing
    decision and the excerpts the answer will be grounded in, then one `token`
    event per piece of generated text, then `end`.
    """

    # A tuple because ruff's RUF012 objects to a mutable class attribute, and
    # DRF only iterates this. JSON first so that a client with no preference —
    # `Accept: */*`, which is what curl sends — gets plain JSON for the error
    # bodies; the SSE framing is for whoever explicitly asked for the stream.
    renderer_classes = (JSONRenderer, ServerSentEventRenderer)

    # Its own bucket, separate from the login endpoints': what limits this one
    # is a GPU that answers about two questions a minute, and what limits those
    # is how fast a password can be guessed. A single rate covering both would
    # be wrong for whichever it was not chosen for (config/settings.py).
    throttle_scope = "ask"

    def unavailable(
        self, exc: EngineUnavailableError, reason: Literal["busy", "unavailable"]
    ) -> Response:
        """A 503 the caller can act on.

        Returned rather than raised so the retry hint can ride along — DRF's
        `Throttled` sets that header for a 429, and a 503 without one leaves the
        caller nothing to back off against.

        `reason` is what separates the two failures that would otherwise arrive
        identically: a queue that is full clears on its own, a model server that
        is not running does not. Without it a client counts down and retries
        forever against an outage. The engine has already logged the cause; what
        travels is the sentence written for whoever called.
        """
        return Response(
            Unavailable(detail=str(exc), reason=reason).model_dump(),
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
        )

    def post(self, request: Request) -> Response | StreamingHttpResponse:
        payload = AskRequest(data=request.data, context={"request": request})
        payload.is_valid(raise_exception=True)
        validated = payload.validated_data

        # The cast is the one apps/accounts/views.py explains: pyright has no
        # django-stubs plugin, so `request.user` is the abstract base to it.
        conversation = open_conversation(cast("User", request.user), validated["conversation"])
        history = recent_turns(conversation)

        events = stream_answer(validated["question"], conversation.pk, validated["locale"], history)
        try:
            # Routing and retrieval happen inside this call — see the module
            # docstring: it is the last moment a status code is still on offer.
            first = next(events)
        # Order matters: the busy case is a subclass of the other one.
        except EngineBusyError as exc:
            return self.unavailable(exc, "busy")
        except EngineUnavailableError as exc:
            return self.unavailable(exc, "unavailable")

        # Written here and not a line earlier. Everything above could still have
        # ended as a 503, and a question refused before it was asked must leave
        # nothing behind (apps/qa/conversations.py).
        #
        # The cast states what apps/qa/contract.py already does: a stream is one
        # `start`, then tokens, then a terminator.
        answer_pk = record_exchange(conversation, cast("StartEvent", first))

        return StreamingHttpResponse(
            _EventStream(first, events, answer_pk),
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
