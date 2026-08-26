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

A stream is one `start`, any number of `token`s, and one terminator::

    event: start
    data: {"question": "...", "conversation_id": 7, "locale": "en", "route": {...},
           "citations": [...]}

    event: token
    data: {"text": "An ORM "}

    event: end
    data: {}

`end` is the completion signal. A stream that stops without it failed — either
`error` arrived in its place or the connection dropped — which lets a client
treat both the same way instead of inferring failure from a sentence that
happens to end mid-word.

This module is the single source for that shape. Stage 4 (the SPA) reads it:
adding a field is additive there, renaming one breaks it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar, Literal

from pydantic import BaseModel, ConfigDict

from rag.agent import RouteDecision
from rag.answer import source_marker

if TYPE_CHECKING:
    from rag.search import Hit


class Citation(BaseModel):
    """One retrieved excerpt, in the shape a reader can act on.

    `marker` is `rag.answer.source_marker` verbatim — the exact string the model
    was instructed to copy into its answer — so a client can match a bracketed
    label in the prose against this list without parsing anything.

    Whether a marker *did* turn up is the client's own `marker in answer` and is
    deliberately not computed here: the answer arrives in pieces that respect no
    boundary of their own, a marker is routinely split across two of them, and
    the check is therefore only meaningful once the whole stream has been
    joined — which is exactly where the client already stands.

    `text` is carried because a slides citation has nothing to click: the PDF is
    not served, so the excerpt itself is its readable form. A web citation adds
    `url` and `fetch_date`, which is the page a student can actually open.
    """

    model_config = ConfigDict(frozen=True)

    marker: str
    kind: Literal["slides", "web"]
    text: str
    heading_path: list[str]
    course: str
    locale: str
    score: float
    source_file: str
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
            locale=chunk.locale,
            score=hit.score,
            source_file=chunk.source_file,
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


class StartEvent(Event):
    """Everything known before a single token exists.

    `route` is `rag.agent.RouteDecision` itself rather than a parallel model:
    the router owns that schema, and a copy here would drift the first time a
    field is added to it.

    `citations` is the grounding set the answer is being generated from — every
    retrieved hit, in retrieval order, one entry each, no deduplication. Two
    chunks of one page share a marker but carry different text and different
    scores, so merging them here would drop an excerpt the reader was answered
    from; a client that wants them merged can group on `marker`. They travel
    first, ahead of the prose, because sources and answer appearing together is
    the claim this system is making.

    `locale` is the language generation was actually asked for, whether the
    request named it or the engine detected it from the question.

    `conversation_id` is where the answer was filed. A request that named no
    conversation started one, and this is how the client learns which — the
    value it sends back to make the next question a follow-up.
    """

    NAME = "start"

    question: str
    conversation_id: int
    locale: str
    route: RouteDecision
    citations: list[Citation]


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


class ErrorEvent(Event):
    """Generation failed after the response had already started.

    By then there is no status code left to send, so this stands in for the 503
    the same failure would have produced a moment earlier — apps/qa/views.py
    draws that line. `detail` is written for whoever called the API.
    """

    NAME = "error"

    detail: str


class Unavailable(BaseModel):
    """The body of the 503 this endpoint sends before a stream has begun.

    Not an event — by definition it happens while a status code is still
    available (apps/qa/views.py draws that line) — but part of the same wire
    contract, so it is declared here and mirrored on the client like the rest.

    `detail` keeps DRF's shape. `reason` is what makes the two collapsed cases
    tellable apart: `busy` is somebody else's question still being answered and
    is worth retrying in a moment, `unavailable` is a model server that is not
    running and will not become one by asking again. Without it a client counts
    down and retries forever against an outage.
    """

    model_config = ConfigDict(frozen=True)

    detail: str
    reason: Literal["busy", "unavailable"]


def sse(name: str, data: str) -> str:
    """One event, framed.

    `data` must already be JSON. A `data:` field ends at the first newline, and
    JSON is the reason no payload here can contain one outside a string literal
    — which is why every event in this module is a model rather than raw text.
    """
    return f"event: {name}\ndata: {data}\n\n"


def sse_event(event: Event) -> str:
    return sse(type(event).NAME, event.model_dump_json())
