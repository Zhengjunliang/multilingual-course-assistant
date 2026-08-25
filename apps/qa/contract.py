"""The `/api/ask` response contract.

Pydantic, and deliberately only in this direction. Every contract the pipeline
already has — `Chunk`, `Hit`, `RouteDecision` — is a pydantic model, so a
second schema language describing the same data would be one more thing to keep
in sync. The request direction is a DRF serializer instead
(apps/qa/serializers.py): that is what `APIView` calls, and it is where the
standard 400 body comes from.

This module is the single source for the wire shape. Stage 3 (SSE) and Stage 4
(the SPA) both read it: adding a field is additive for them, renaming one
breaks both at once.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

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

    `text` is carried because a slides citation has nothing to click: the PDF is
    not served, so the excerpt itself is its readable form. A web citation adds
    `url` and `fetch_date`, which is the page a student can actually open.
    """

    model_config = ConfigDict(frozen=True)

    marker: str
    cited: bool
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
    def of(cls, hit: Hit, answer_text: str) -> Citation:
        """`cited` is a literal substring test, never a judgement.

        The generation prompt spends three lines fighting the model's habit of
        shortening a marker (rag/answer.py), so `False` here means "did not
        appear character for character" and nothing more. Reading it as "this
        excerpt went unused" would turn a formatting slip into a missing source.
        """
        marker = source_marker(hit)
        chunk = hit.chunk
        return cls(
            marker=marker,
            cited=marker in answer_text,
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


class AskResponse(BaseModel):
    """One answered question, on the wire.

    `route` is `rag.agent.RouteDecision` itself rather than a parallel model:
    the router owns that schema, and a copy here would drift the first time a
    field is added to it.

    `citations` is the grounding set the answer was generated from — every
    retrieved hit, in retrieval order, one entry each, no deduplication. Two
    chunks of the same page share a marker but carry different text and
    different scores, so merging them here would throw away something the client
    can recover for itself by grouping on `marker`. It is not a parse of the
    answer prose; see `Citation.of`.

    `locale` is the language generation was actually asked for, whether the
    request named it or `Engine.ask` detected it from the question.
    """

    model_config = ConfigDict(frozen=True)

    question: str
    locale: str
    answer: str
    route: RouteDecision
    citations: list[Citation]
