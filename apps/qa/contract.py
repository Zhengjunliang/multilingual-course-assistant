"""The `/api/ask` wire contract: what the answer stream is made of.

Pydantic, and deliberately only in this direction. Every contract the pipeline
already has — `Chunk`, `Hit`, `RouteDecision` — is a pydantic model, so a
second schema language describing the same data would be one more thing to keep
in sync. The request direction is a DRF serializer instead
(apps/qa/serializers.py): that is what `APIView` calls, and it is where the
standard 400 body comes from.

The framing lives here too. Server-sent events are a media type the way JSON is,
not an HTTP semantic, so keeping the event names apart from the models that
define them would split one wire shape across two files. `apps/qa/engine.py`
yields these models and never sees the framing; `apps/qa/views.py` frames them
and never builds one.

A stream is one `queued`, one `start`, any number of `token`s, and one
terminator, each event under the id it has in the answer's Redis stream
(apps/qa/inflight.py)::

    id: 1730200000000-0
    event: queued
    data: {"answer_id": "9b2e…", "conversation_id": "3f1c9a52-…", "question": "..."}

    id: 1730200004211-0
    event: start
    data: {"question": "...", "conversation_id": "3f1c9a52-…", "locale": "en",
           "route": {...}, "citations": [...]}

    id: 1730200004390-0
    event: token
    data: {"text": "An ORM "}

    id: 1730200009120-0
    event: end
    data: {}

The id is what a reader who lost the connection sends back as
`Last-Event-ID`, to be given the events after it (apps/qa/views.py). A line
that starts with a colon is a comment the server sends while nothing else is
to be said, to keep the connection open; a client skips it.

`end` is the completion signal, and `stopped` and `error` are the two ways an
answer ends without it: someone asked it to stop, or it failed. A stream that
stops with none of the three lost its connection, which lets a client tell an
answer that stopped from one it can still resume instead of inferring either
from a sentence that happens to end mid-word.

This module is the single source for that shape. The frontend reads it:
adding a field is additive there, renaming one breaks it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from config.errors import ErrorBody
from rag.agent import RouteDecision
from rag.answer import source_marker

if TYPE_CHECKING:
    from rag.search import Hit


class Citation(BaseModel):
    """One retrieved excerpt, in the shape a reader can act on.

    The answer cites by number: `[n]` names the n-th citation of the list, the
    number the excerpt carried in the prompt (`rag.answer.format_context`).
    `marker` is `rag.answer.source_marker` verbatim, the label printed beside
    that number; answers generated before 2026-10-12 were told to copy it and
    cite by it, so a client matches it in their prose without parsing anything.

    Whether a citation *did* turn up is the client's own search of the answer
    and is deliberately not computed here: the answer arrives in pieces that
    respect no boundary of their own, a citation is routinely split across two
    of them, and the check is therefore only meaningful once the whole stream
    has been joined — which is exactly where the client already stands.

    `text` is the excerpt itself, readable without leaving the answer. A slides
    citation also carries `source_sha256`, the key under which
    `GET /api/sources/<sha256>` serves its PDF (apps/qa/source_views.py); a web
    citation carries None there and adds `url` and `fetch_date`, the page a
    student can open. With `course`, a slides citation's `academic_year` names
    the edition the excerpt came from (`B028451`, `2025-2026`); None for web.
    A citation stored before a field existed lacks it (docs/data-model.md,
    migration order).
    """

    model_config = ConfigDict(frozen=True)

    marker: str
    kind: Literal["slides", "web"]
    text: str
    heading_path: list[str]
    course: str
    academic_year: str | None
    locale: str
    score: float
    source_file: str
    source_sha256: str | None
    page: int
    url: str | None
    fetch_date: str | None

    @classmethod
    def of(cls, hit: Hit) -> Citation:
        chunk = hit.chunk
        return cls(
            marker=source_marker(hit),
            kind=chunk.kind,
            text=chunk.text,
            heading_path=chunk.heading_path,
            course=chunk.course,
            # By kind, like `source_sha256`: an edition is a slides notion, and
            # a web chunk that happens to carry a year names no edition.
            academic_year=chunk.academic_year if chunk.kind == "slides" else None,
            locale=chunk.locale,
            score=hit.score,
            source_file=chunk.source_file,
            # A web chunk has a sha too, of its crawled page; only a slides one
            # names a file the sources endpoint serves.
            source_sha256=chunk.source_sha256 if chunk.kind == "slides" else None,
            page=chunk.page,
            url=chunk.url,
            fetch_date=chunk.fetch_date,
        )


class Event(BaseModel):
    """One event in the answer stream.

    `NAME` is the value of the `event:` line, declared beside the fields it
    labels so that framing an event never needs a dispatch table somewhere else.
    The `ClassVar` annotation is load-bearing: without it pydantic reads the
    attribute as a field and it would be serialised into every payload.
    """

    model_config = ConfigDict(frozen=True)

    NAME: ClassVar[str]


class QueuedEvent(Event):
    """The question was admitted and waits for a worker. Always first.

    `answer_id` names the answer everywhere it is kept: the stream its events
    are read back from after a reload, and the stop endpoint
    (apps/qa/views.py). It is the stored answer's id too, once the worker has
    written it. `conversation_id` is `StartEvent`'s, known this early, so that
    a new conversation is a place to come back to while its first question
    still waits; `question` is the question as asked, so that a reader who
    reloads while it waits sees what it is waiting for.
    """

    NAME = "queued"

    answer_id: UUID
    conversation_id: UUID | None
    question: str


class StartEvent(Event):
    """Everything known before a single token exists.

    `route` is `rag.agent.RouteDecision` itself rather than a parallel model:
    the router owns that schema, and a copy here would drift the first time a
    field is added to it.

    `citations` is the grounding set the answer is being generated from — every
    retrieved hit, in retrieval order, one entry each. Retrieval has already
    collapsed the copies of one passage into one hit (`rag.passages`); two
    chunks of one page are two passages, sharing a marker but carrying
    different text and different scores, so merging them here would drop an
    excerpt the reader was answered from; a client that wants them merged can
    group on `marker`. They travel
    first, ahead of the prose, because sources and answer appearing together is
    the claim this system is making.

    `locale` is the language generation was actually asked for, whether the
    request named it or the engine detected it from the question.

    `conversation_id` is where the answer was filed. A request that named no
    conversation started one, and this is how the client learns which — the
    value it sends back to make the next question a follow-up. None for an
    anonymous question, which is filed nowhere: its client keeps the thread and
    sends it back as `history` (apps/qa/serializers.py).

    `search_ms` is how long the reader waited for this event, in milliseconds:
    from the question being admitted (`queued`) to `start` going out. The wait
    for a worker is in it, as well as routing and retrieval: the interface
    counts the seconds from the moment the question is asked, and a total that
    left the queue out would fold a count of 50 into "15". It is stored with
    the answer so a reopened conversation shows the same number rather than
    none.
    """

    NAME = "start"

    question: str
    conversation_id: UUID | None
    locale: str
    route: RouteDecision
    citations: list[Citation]
    search_ms: int


class TokenEvent(Event):
    """One piece of the answer, exactly as the model produced it.

    The pieces carry no structure — they break wherever the tokenizer did — so
    the answer is their concatenation and nothing else.
    """

    NAME = "token"

    text: str


class EndEvent(Event):
    """The answer is complete. Empty on purpose: its arrival is the message."""

    NAME = "end"


class StoppedEvent(Event):
    """The answer was stopped before its end: by the stop button, or, for a
    visitor, by leaving. Empty, like `end`. What was written before it is kept
    as an unfinished answer (apps/qa/tasks.py)."""

    NAME = "stopped"


class ErrorEvent(Event):
    """The answer failed after the response had already started.

    By then there is no status code left to send, so this stands in for the one
    the same failure would have produced before the stream opened, and carries
    the body it would have: `ENGINE_DOWN` for a service that is down,
    `UNAVAILABLE` for a question no worker took before its lease ran out,
    `CONVERSATION_GONE` for a conversation deleted while its question waited,
    `INTERNAL` for a defect, under the id of the request that asked
    (config/errors.py).
    """

    NAME = "error"

    error: ErrorBody


# The events after which an answer has nothing more to say.
TERMINAL = frozenset({EndEvent.NAME, StoppedEvent.NAME, ErrorEvent.NAME})

# A comment line: sent while nothing else is, so that the connection is never
# idle long enough for a proxy to close it, and so that a reader who left is
# noticed (apps/qa/views.py).
KEEPALIVE = ": keepalive\n\n"


def sse(name: str, data: str, event_id: str | None = None) -> str:
    """One event, framed.

    `data` must already be JSON. A `data:` field ends at the first newline, and
    JSON is the reason no payload here can contain one outside a string literal
    — which is why every event in this module is a model rather than raw text.
    """
    framed = f"event: {name}\ndata: {data}\n\n"
    return framed if event_id is None else f"id: {event_id}\n{framed}"


def sse_event(event: Event) -> str:
    return sse(type(event).NAME, event.model_dump_json())
