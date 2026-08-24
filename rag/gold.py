"""Retrieval smoke check against the gold set: hit@k per question.

A hit means some top-k chunk comes from the question's `source_file` and spans
its `page`. This is the M2 tuning signal (chunk size / top-k / prompt) — the
real evaluation harness (RAGAS, retrieval metrics, error taxonomy) belongs to
M3 and does not live here.

`--routing` is a second, independent report over the same file: it scores the
router's collection choice against the gold `target` and runs no retrieval at
all — no encoders, no reranker, no index.

    uv run python -m rag.gold gold/smoke.jsonl
    uv run python -m rag.gold gold/smoke.jsonl --no-rerank --top-k 10
    uv run python -m rag.gold gold/campus.jsonl --routing
    uv run python -m rag.gold gold/campus-autogrow.jsonl --live on
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from rag.agent import FALLBACK_REASON, collections_for, route
from rag.probe import configure_cli_logging
from rag.search import DEFAULT_RERANK_MODEL, build_reranker, search

if TYPE_CHECKING:
    from collections.abc import Sequence

    from rag.llm import Completer
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


class RoutingRow(BaseModel):
    """One question's routing outcome under `--routing`."""

    model_config = ConfigDict(frozen=True)

    id: str
    gold_target: str
    routed_target: str
    exact: bool
    wide: bool
    fallback: bool


class RoutingReport(BaseModel):
    """Four counts side by side, because one rate cannot tell the failure modes
    apart: `exact` scores `both` against a specific gold target as a miss (the
    primary number), `wide` accepts any routed set that contains the gold
    target, and the `both`/`fallback` counts say how much of the gap is the 4B
    model hedging versus failing schema validation outright."""

    model_config = ConfigDict(frozen=True)

    rows: list[RoutingRow]
    exact: int
    wide: int
    both: int
    fallback: int


def routing_report(questions: Sequence[GoldQuestion], completer: Completer) -> RoutingReport:
    """Route every question and score the choice. Pure report: the collections
    are scored as names, never opened."""
    rows: list[RoutingRow] = []
    for question in questions:
        decision = route(question.question, completer)
        rows.append(
            RoutingRow(
                id=question.id,
                gold_target=question.target,
                routed_target=decision.target,
                exact=decision.target == question.target,
                wide=question.target in collections_for(decision),
                # Identity against the router's own constant, not a prefix: a
                # validated reply is free to explain itself with the word
                # "fallback" without being counted as a schema failure.
                fallback=decision.reason == FALLBACK_REASON,
            )
        )
    return RoutingReport(
        rows=rows,
        exact=sum(row.exact for row in rows),
        wide=sum(row.wide for row in rows),
        both=sum(row.routed_target == "both" for row in rows),
        fallback=sum(row.fallback for row in rows),
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
    # Eval reads the frozen crawl snapshot by default: a live increment written
    # between two runs would otherwise move a gate number, and the gates are the
    # thesis' regression evidence (ADR-1, docs/architettura.md).
    parser.add_argument("--ingest-source", choices=["crawl", "live"], default="crawl")
    parser.add_argument(
        "--snapshot",
        metavar="run_id",
        default=None,
        help="narrow web retrieval to a single ingest run",
    )
    parser.add_argument(
        "--live",
        choices=["off", "on"],
        default="off",
        help="'on' drops the web-source condition so retrieval also sees what "
        "the autogrow run wrote; 'off' keeps eval on the crawl snapshot",
    )
    parser.add_argument(
        "--routing",
        action="store_true",
        help="report-only: score the router's collection choice per question, "
        "without retrieving anything",
    )
    args = parser.parse_args(argv)

    configure_cli_logging()
    questions = load_gold(args.gold_file)
    dangling = missing_answer_refs(questions, Path())
    if dangling:
        logger.warning("answer_ref not on disk for: %s", ", ".join(dangling))

    if args.routing:
        # Short-circuit before any model is built: the retrieval stack costs
        # ~2.4GB of VRAM that the routing report has no use for.
        from config.env import env
        from rag.llm import build_completer

        overridden = [
            name
            for name in ("top_k", "no_rerank", "qdrant_path", "dense_model", "rerank_model", "live")
            if getattr(args, name) != parser.get_default(name)
        ]
        if overridden:
            logger.warning(
                "routing report is LLM-only; retrieval flags ignored: %s", ", ".join(overridden)
            )
        # Fixed seed: the run-twice-identical gate must not rest on greedy
        # decoding alone; recorded in diario at Stage 9.
        report = routing_report(
            questions,
            build_completer(
                env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0, seed=0
            ),
        )
        for row in report.rows:
            print(
                f"{row.id} {row.gold_target} -> {row.routed_target}"
                f"{' FALLBACK' if row.fallback else ''}"
            )
        total = len(report.rows)
        for label, count in (
            ("exact-hit", report.exact),
            ("wide-hit", report.wide),
            ("both", report.both),
            ("fallback", report.fallback),
        ):
            print(f"{label}: {count}/{total} ({count / total if total else 0.0:.0%})")
        return

    # ADR-1's explicit release: the autogrow acceptance has to see the pages the
    # run just wrote, and the answer may sit in either version of a page, so
    # `--live on` drops the condition rather than pointing it at "live".
    ingest_source = None if args.live == "on" else args.ingest_source
    if ingest_source is None and args.ingest_source != parser.get_default("ingest_source"):
        logger.warning("--live on opens the filter; --ingest-source %s ignored", args.ingest_source)

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
            # Single passthrough, no per-collection branching: `search()` drops
            # both web-source conditions on every non-web prefetch branch.
            ingest_source=ingest_source,
            ingest_run_id=args.snapshot,
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
