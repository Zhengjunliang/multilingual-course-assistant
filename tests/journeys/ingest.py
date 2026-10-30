"""The journeys' ingest (`MATERIALS_PIPELINE` in tests/journeys/settings.py):
rag's own parse, chunk and index steps over stubs, writing into the index the
journeys' questions are answered from (tests/journeys/retrieval.py).

Every PDF reads as the same one-page document, through the stub converter of
tests/test_parse.py with the parse plan given, so nothing probes the file;
its digest is still the file's, which is how `/api/sources/<sha256>` finds
it. One chunk, by the word-counting chunker of tests/test_chunk.py: with the
two excerpts already indexed, fewer than an answer's five sources
(apps/qa/engine.py, `TOP_K`), so an uploaded file is among them whatever
the stub encoders make of the question.
"""

from __future__ import annotations

from functools import partial
from typing import TYPE_CHECKING, cast

from apps.materials.ingest import Pipeline
from rag.parse import parse_pdf
from tests.journeys.retrieval import index
from tests.test_chunk import word_chunker
from tests.test_index import StubDense, StubSparse
from tests.test_parse import CLASSIC, StubConverter

if TYPE_CHECKING:
    from docling.document_converter import DocumentConverter
    from docling_core.types.doc.document import DoclingDocument


def one_page() -> DoclingDocument:
    from docling_core.types.doc.base import BoundingBox
    from docling_core.types.doc.common.reference import ProvenanceItem
    from docling_core.types.doc.document import DoclingDocument
    from docling_core.types.doc.labels import DocItemLabel

    text = "Il test di Turing confronta una macchina con una persona."
    document = DoclingDocument(name="material")
    heading = document.add_heading(
        text="Il test di Turing",
        prov=ProvenanceItem(page_no=1, bbox=BoundingBox(l=0, t=0, r=100, b=100), charspan=(0, 17)),
    )
    document.add_text(
        label=DocItemLabel.TEXT,
        text=text,
        prov=ProvenanceItem(
            page_no=1, bbox=BoundingBox(l=0, t=0, r=100, b=100), charspan=(0, len(text))
        ),
        parent=heading,
    )
    return document


def build_pipeline() -> Pipeline:
    converter = cast("DocumentConverter", StubConverter(document=one_page()))
    return Pipeline(
        parse=partial(parse_pdf, converters={"classic": converter}, plan=CLASSIC),
        chunker=word_chunker(),
        dense=StubDense(),
        sparse=StubSparse(),
        client=index(),
    )
