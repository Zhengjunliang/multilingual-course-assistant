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

from pydantic import BaseModel, ConfigDict, Field

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
    # Campus questions score by URL and leave these at their defaults; the
    # defaults exist only for that row shape — a slides question without a real
    # source_file/page is a broken line and human review is the gate.
    source_file: str = ""
    page: int = 0
    answer_ref: str
    # Routing label for the M2.5 agent: which collection should answer this.
    # Default keeps every existing slides line valid without rewriting the file.
    target: str = "slides"
    # Ground-truth pages for campus questions: a hit is any retrieved web chunk
    # whose url matches one of these (trailing-slash insensitive).
    urls: list[str] = Field(default_factory=list)


def load_gold(path: Path) -> list[GoldQuestion]:
    return [
        GoldQuestion.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def missing_answer_refs(questions: Sequence[GoldQuestion], root: Path) -> list[str]:
    """Reference answers live outside git (gold/README.md), so a dangling
    `answer_ref` passes every retrieval check silently — surface it instead."""
    return [q.id for q in questions if not (root / q.answer_ref).is_file()]


def is_hit(question: GoldQuestion, hits: Sequence[Hit]) -> bool:
    """Slides questions score by (source_file, page); campus questions carry
    `urls` and score by URL match on web chunks."""
    if question.urls:
        wanted = {url.rstrip("/") for url in question.urls}
        return any(
            hit.chunk.url is not None and hit.chunk.url.rstrip("/") in wanted for hit in hits
        )
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
    dangling = missing_answer_refs(questions, Path())
    if dangling:
        logger.warning("answer_ref not on disk for: %s", ", ".join(dangling))

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)

    scored = 0
    per_locale: dict[str, list[bool]] = {}
    for question in questions:
        # `target` names the collection to score against (gold/README.md):
        # slides questions stay single-collection slides, campus questions
        # single-collection unifi_web — the non-regression gates keep constant
        # semantics; merged pools exist only behind the M2.5b agent router.
        hits = search(
            client,
            question.question,
            dense,
            sparse,
            reranker,
            limit=args.top_k,
            collections=(question.target,),
        )
        hit = is_hit(question, hits)
        scored += hit
        per_locale.setdefault(question.locale, []).append(hit)
        top = hits[0].chunk if hits else None
        want = ", ".join(question.urls) or f"{question.source_file} p.{question.page}"
        if top is None:
            shown = "-"
        elif top.kind == "web" and top.url:
            shown = top.url
        else:
            shown = f"{top.source_file} p.{top.page}"
        print(f"{question.id} {'HIT ' if hit else 'MISS'} want {want} | top: {shown}")
    client.close()

    total = len(questions)
    rate = scored / total if total else 0.0
    print(f"hit@{args.top_k}: {scored}/{total} ({rate:.0%})")
    # Per-locale rates carry the campus gate (EN/IT thresholded, ZH reported
    # without one — docs/fonte-web-unifi.md); printed only when locales mix.
    if len(per_locale) > 1:
        for locale in sorted(per_locale):
            outcomes = per_locale[locale]
            print(
                f"hit@{args.top_k} [{locale}]: {sum(outcomes)}/{len(outcomes)} "
                f"({sum(outcomes) / len(outcomes):.0%})"
            )


if __name__ == "__main__":
    main()
