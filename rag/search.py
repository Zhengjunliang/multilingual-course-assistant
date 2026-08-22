"""Hybrid retrieval over the Qdrant index built by `rag.index`.

One query fans out into two prefetch branches — dense (Qwen3-Embedding, query
prompt) and sparse (BM25) — fused with Reciprocal Rank Fusion, then optionally
reordered by Qwen3-Reranker. Payload filters (`--locale`, `--course`) must sit
inside *each* prefetch branch: with fusion queries the embedded Qdrant ignores
a top-level filter (verified empirically).

    uv run python -m rag.search "What is an ORM?"
    uv run python -m rag.search "Cosa sono le migrazioni?" --locale it --no-rerank
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, cast

from pydantic import BaseModel, ConfigDict

from rag.chunk import Chunk, locale_arg
from rag.index import (
    COLLECTION,
    DEFAULT_DENSE_MODEL,
    DEFAULT_QDRANT_DIR,
    DENSE_VECTOR,
    SPARSE_VECTOR,
    DenseEncoder,
    SparseEncoder,
    build_dense_encoder,
    build_sparse_encoder,
    open_client,
)
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from collections.abc import Sequence

    from qdrant_client import QdrantClient
    from qdrant_client import models as qmodels

logger = logging.getLogger(__name__)

DEFAULT_RERANK_MODEL = "Qwen/Qwen3-Reranker-0.6B"

# Fusion sees this many candidates per branch; the reranker sees the fused pool.
PREFETCH_LIMIT = 20


class Hit(BaseModel):
    model_config = ConfigDict(frozen=True)

    chunk: Chunk
    score: float


class Reranker(Protocol):
    def rerank(self, query: str, texts: Sequence[str]) -> list[float]: ...


class _QwenReranker:
    """The official Qwen3-Reranker recipe: the checkpoint is a *causal LM* asked
    to answer yes/no per (query, document) pair, scored as P("yes") over the two
    tokens at the last position. Loading it through a sequence-classification
    wrapper (e.g. CrossEncoder) silently attaches a randomly initialized head
    and produces garbage — never do that."""

    _PREFIX = (
        "<|im_start|>system\nJudge whether the Document meets the requirements based on "
        'the Query and the Instruct provided. Note that the answer can only be "yes" or '
        '"no".<|im_end|>\n<|im_start|>user\n'
    )
    _SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    _INSTRUCTION = "Given a web search query, retrieve relevant passages that answer the query"

    # transformers ships no type stubs; the untyped model/tokenizer objects are
    # quarantined behind Any inside this class instead of leaking ignores around.
    def __init__(self, model_name: str) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self._torch = torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._tokenizer = cast(
            "Any",
            AutoTokenizer.from_pretrained(model_name, padding_side="left"),  # pyright: ignore[reportUnknownMemberType]
        )
        model = cast(
            "Any",
            AutoModelForCausalLM.from_pretrained(  # pyright: ignore[reportUnknownMemberType]
                model_name,
                dtype=torch.float16 if self._device == "cuda" else torch.float32,
            ),
        )
        self._model = model.to(self._device).eval()
        self._yes = int(self._tokenizer.convert_tokens_to_ids("yes"))
        self._no = int(self._tokenizer.convert_tokens_to_ids("no"))

    def rerank(self, query: str, texts: Sequence[str]) -> list[float]:
        torch = self._torch
        prompts = [
            f"{self._PREFIX}<Instruct>: {self._INSTRUCTION}\n"
            f"<Query>: {query}\n<Document>: {text}{self._SUFFIX}"
            for text in texts
        ]
        with torch.no_grad():
            inputs: Any = self._tokenizer(
                prompts, padding=True, truncation=True, max_length=4096, return_tensors="pt"
            ).to(self._device)
            logits: Any = self._model(**inputs).logits[:, -1, :]
            pair = torch.stack([logits[:, self._no], logits[:, self._yes]], dim=1)
            scores: Any = torch.nn.functional.log_softmax(pair.float(), dim=1)[:, 1].exp()
        return [float(score) for score in scores.tolist()]


def build_reranker(model_name: str = DEFAULT_RERANK_MODEL) -> Reranker:
    return _QwenReranker(model_name)


def payload_filter(locale: str | None, course: str | None) -> qmodels.Filter | None:
    from qdrant_client import models

    conditions: list[models.FieldCondition] = []
    if locale:
        conditions.append(
            models.FieldCondition(key="locale", match=models.MatchValue(value=locale))
        )
    if course:
        conditions.append(
            models.FieldCondition(key="course", match=models.MatchValue(value=course))
        )
    return models.Filter(must=list(conditions)) if conditions else None


def hybrid_search(
    client: QdrantClient,
    query: str,
    dense: DenseEncoder,
    sparse: SparseEncoder,
    *,
    limit: int = 5,
    prefetch_limit: int = PREFETCH_LIMIT,
    locale: str | None = None,
    course: str | None = None,
    collection: str = COLLECTION,
) -> list[Hit]:
    from qdrant_client import models

    indices, values = sparse.encode_query(query)
    query_filter = payload_filter(locale, course)
    response = client.query_points(
        collection,
        prefetch=[
            models.Prefetch(
                query=dense.encode_query(query),
                using=DENSE_VECTOR,
                limit=prefetch_limit,
                filter=query_filter,
            ),
            models.Prefetch(
                query=models.SparseVector(indices=indices, values=values),
                using=SPARSE_VECTOR,
                limit=prefetch_limit,
                filter=query_filter,
            ),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=limit,
        with_payload=True,
    )
    return [
        Hit(chunk=Chunk.model_validate(point.payload), score=point.score)
        for point in response.points
    ]


def rerank_hits(query: str, hits: Sequence[Hit], reranker: Reranker, limit: int) -> list[Hit]:
    """Replace fusion scores with reranker scores and keep the best `limit`.
    The reranker reads raw `text` — the same thing the user will be shown."""
    if not hits:
        return []
    scores = reranker.rerank(query, [hit.chunk.text for hit in hits])
    rescored = [Hit(chunk=hit.chunk, score=score) for hit, score in zip(hits, scores, strict=True)]
    return sorted(rescored, key=lambda hit: hit.score, reverse=True)[:limit]


def search(
    client: QdrantClient,
    query: str,
    dense: DenseEncoder,
    sparse: SparseEncoder,
    reranker: Reranker | None,
    *,
    limit: int = 5,
    locale: str | None = None,
    course: str | None = None,
    collection: str = COLLECTION,
) -> list[Hit]:
    """The full retrieval pipeline: with a reranker, fusion produces the wide
    candidate pool and the reranker picks the final `limit`; without one, fusion
    order is the final order (the M3 no-rerank baseline)."""
    candidates = hybrid_search(
        client,
        query,
        dense,
        sparse,
        limit=PREFETCH_LIMIT if reranker else limit,
        locale=locale,
        course=course,
        collection=collection,
    )
    if reranker is None:
        return candidates[:limit]
    return rerank_hits(query, candidates, reranker, limit)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query")
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--collection", default=COLLECTION)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    parser.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    parser.add_argument("--no-rerank", action="store_true", help="fusion order only (M3 baseline)")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--locale", type=locale_arg, default=None)
    parser.add_argument("--course", default=None)
    args = parser.parse_args(argv)

    configure_cli_logging()

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)

    hits = search(
        client,
        args.query,
        dense,
        sparse,
        reranker,
        limit=args.top_k,
        locale=args.locale,
        course=args.course,
        collection=args.collection,
    )
    client.close()

    for rank, hit in enumerate(hits, start=1):
        chunk = hit.chunk
        preview = chunk.text[:160].replace("\n", " ")
        print(f"{rank}. [{hit.score:.4f}] {chunk.source_file} p.{chunk.page} ({chunk.locale})")
        print(f"   {' > '.join(chunk.heading_path) or '-'}")
        print(f"   {preview}")


if __name__ == "__main__":
    main()
