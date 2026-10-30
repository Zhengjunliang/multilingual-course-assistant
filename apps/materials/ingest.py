"""The resources an ingest runs on, built once per worker process.

The ingest of a material (apps/materials/tasks.py) runs the steps of `rag/`
itself — probe and parse (`rag.parse.parse_pdf`), chunk
(`rag.chunk.chunk_document`), index (`rag.index.index_chunks`) — on what
this module builds once, as apps/qa/engine.py builds the question engine's:
the converters, one per parse variant, the tokenizer behind the chunker, the
two encoders and the Qdrant client. The dense encoder is
`rag.index.cached_dense_encoder`'s, so a worker that answers questions too
holds one copy of it.

Built by the callable `MATERIALS_PIPELINE` names (config/settings.py), as
`QA_RETRIEVAL` names the engine's retrieval, so the browser journeys parse
no PDF and load no model without a test branch in this file.

Nothing is written under data/parsed or data/chunks. Those files are named by
the source file's stem, so one name in two editions would overwrite the
other's; they are the command line's, for the M3 experiments, and a
material's document lives on as its points alone.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache, partial
from typing import TYPE_CHECKING, Protocol

from rag.parse import parse_pdf

if TYPE_CHECKING:
    from pathlib import Path

    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
    from qdrant_client import QdrantClient

    from rag.index import DenseEncoder, SparseEncoder
    from rag.parse import ParsedPdf


class Parser(Protocol):
    """`rag.parse.parse_pdf` with its converter cache bound."""

    def __call__(
        self, pdf: Path, *, course: str, academic_year: str, source_file: str
    ) -> ParsedPdf: ...


@dataclass(frozen=True)
class Pipeline:
    parse: Parser
    chunker: HybridChunker
    dense: DenseEncoder
    sparse: SparseEncoder
    client: QdrantClient


def build_pipeline() -> Pipeline:
    """The Qdrant service with its slides collection, the encoders, the chunker and the parser.

    The parser decodes formulas on every file, as docs/docling-pipeline.md
    decides for a resident process, and builds a converter for each variant
    as it first comes up: two at most, with OCR and without.
    """
    from rag.chunk import DEFAULT_MAX_TOKENS, DEFAULT_TOKENIZER, build_chunker, build_tokenizer
    from rag.index import build_sparse_encoder, cached_dense_encoder, ensure_collection, open_client

    client = open_client()
    try:
        dense = cached_dense_encoder()
        ensure_collection(client, dense.dimension())
        return Pipeline(
            parse=partial(parse_pdf, converters={}, formula=True),
            chunker=build_chunker(build_tokenizer(DEFAULT_TOKENIZER, DEFAULT_MAX_TOKENS)),
            dense=dense,
            sparse=build_sparse_encoder(),
            client=client,
        )
    except Exception:
        # Not cached, so the next ingest opens a client of its own: closing
        # this one keeps a model load that keeps failing from piling them up.
        client.close()
        raise


@cache
def loaded_pipeline() -> Pipeline:
    """This process's pipeline, built by the first ingest; a failed build is not cached.

    No lock: ingest runs one material at a time in a process, on the solo
    pool or a prefork worker of concurrency 1 (docs/background-tasks.md).
    """
    from django.conf import settings
    from django.utils.module_loading import import_string

    return import_string(settings.MATERIALS_PIPELINE)()
