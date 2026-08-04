"""Retrieval smoke check against the gold set: hit@k per question.

A hit means some top-k chunk comes from the question's `source_file` and spans
its `page`. This is the M2 tuning signal (chunk size / top-k / prompt) — the
real evaluation harness (RAGAS, retrieval metrics, error taxonomy) belongs to
M3 and does not live here.

    uv run python -m rag.gold gold/smoke.jsonl
    uv run python -m rag.gold gold/smoke.jsonl --no-rerank --top-k 10
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

from rag.probe import configure_cli_logging
from rag.search import DEFAULT_RERANK_MODEL, build_reranker, search

if TYPE_CHECKING:
    from collections.abc import Sequence

    from rag.search import Hit

logger = logging.getLogger(__name__)


class GoldQuestion(BaseModel):
    """One line of gold/smoke.jsonl (schema owned by gold/README.md)."""

    model_config = ConfigDict(frozen=True)

    id: str
    locale: str
    question: str
    source_file: str
    page: int
    answer_ref: str


def load_gold(path: Path) -> list[GoldQuestion]:
    return [
        GoldQuestion.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def is_hit(question: GoldQuestion, hits: Sequence[Hit]) -> bool:
    return any(
        hit.chunk.source_file == question.source_file and question.page in hit.chunk.pages
        for hit in hits
    )


def main(argv: list[str] | None = None) -> None:
    from rag.index import (
        DEFAULT_DENSE_MODEL,
        DEFAULT_QDRANT_DIR,
        build_dense_encoder,
        build_sparse_encoder,
        open_client,
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gold_file", type=Path)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--no-rerank", action="store_true")
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    parser.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    args = parser.parse_args(argv)

    configure_cli_logging()
    questions = load_gold(args.gold_file)

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)

    scored = 0
    for question in questions:
        hits = search(client, question.question, dense, sparse, reranker, limit=args.top_k)
        hit = is_hit(question, hits)
        scored += hit
        top = hits[0].chunk if hits else None
        print(
            f"{question.id} {'HIT ' if hit else 'MISS'} "
            f"want {question.source_file} p.{question.page}"
            + (f" | top: {top.source_file} p.{top.page}" if top else " | top: -")
        )
    client.close()

    total = len(questions)
    rate = scored / total if total else 0.0
    print(f"hit@{args.top_k}: {scored}/{total} ({rate:.0%})")


if __name__ == "__main__":
    main()
