"""Question routing: pick the knowledge base, rewrite the retrieval query.

The agent is pure control flow and reads only (the module boundary rule,
docs/architettura.md): it routes, retrieves and hands the hits to generation —
writing to the shared knowledge base belongs to `rag/live.py` alone, so nothing
here may reach an index write path.

The router is a 4B quantized model, so an unusable reply is an expected event
rather than an exception: `route()` falls back to `target="both"` and says so in
`reason`. That fallback is the frozen contract — searching both collections
costs latency, never correctness. When retrieval comes back empty the answer is
still an honest refusal, followed by the one thing a student can act on: paste
the URL of the page that holds the answer.

    uv run python -m rag.agent "What is an ORM?"
    uv run python -m rag.agent "Quando scadono le tasse?" --locale it --no-rerank
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from rag.answer import answer, print_sources
from rag.chunk import detect_locale, locale_arg
from rag.index import COLLECTION, WEB_COLLECTION
from rag.llm import Completer, Message, build_completer, build_streamer, complete_json
from rag.probe import configure_cli_logging
from rag.search import DEFAULT_RERANK_MODEL, build_reranker, search

logger = logging.getLogger(__name__)

FALLBACK_REASON = "fallback: unparseable router reply"

ROUTER_SYSTEM_PROMPT = """\
You route a student's question to the knowledge base that can answer it.

- "slides": course material — lectures, exercises, exam topics.
- "unifi_web": University of Florence campus and administrative information — \
deadlines, offices, services, enrolment, fees, DSU, housing.
- "both": the question spans both, or you are unsure.

Also rewrite the question into a short retrieval query in the language of the \
question, and set "fresh" to true only when the answer needs a page newer than a \
stored snapshot (an open call, a current deadline).

Reply with ONLY one JSON object, no prose:
{"target": "slides|unifi_web|both", "query": "...", "fresh": false, "reason": "..."}"""


class RouteDecision(BaseModel):
    """The router's reply (fields owned by the M2.5b ROADMAP checklist).

    `target` ranges over the two real collection names plus the routing-only
    `both`; `query` is the rewritten retrieval query, while generation keeps the
    student's original wording. `fresh` is inert here — the deepening loop is
    its only consumer — and defaults so that a dropped flag costs a hint rather
    than the whole decision.
    """

    model_config = ConfigDict(frozen=True)

    target: Literal["slides", "unifi_web", "both"]
    query: str
    fresh: bool = False
    reason: str


def route(question: str, completer: Completer) -> RouteDecision:
    """An unusable reply is a routing decision too: `both` searches everything."""
    messages: list[Message] = [
        {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    decision = complete_json(completer, messages, RouteDecision)
    if decision is None:
        return RouteDecision(target="both", query=question, fresh=False, reason=FALLBACK_REASON)
    return decision


def collections_for(decision: RouteDecision) -> tuple[str, ...]:
    """`both` is the merged pool the gates never use: evaluation stays
    single-collection (rag/gold.py), only the agent retrieves across the two."""
    if decision.target == "slides":
        return (COLLECTION,)
    if decision.target == "unifi_web":
        return (WEB_COLLECTION,)
    return (COLLECTION, WEB_COLLECTION)


def pointer_line(locale: str) -> str:
    """A refusal that leaves the student nothing to do is a dead end: the shared
    knowledge base grows from the URLs they paste, so the refusal says so."""
    return {
        "it": "Se mi incolli l'URL della pagina che contiene la risposta, posso impararla.",
        "zh": "把包含答案的网页链接贴给我，我就能学会。",  # noqa: RUF001 — Chinese punctuation
    }.get(locale, "If you paste the URL of the page that contains the answer, I can learn it.")


def main(argv: list[str] | None = None) -> None:
    from config.env import env
    from rag.index import (
        DEFAULT_DENSE_MODEL,
        DEFAULT_QDRANT_DIR,
        build_dense_encoder,
        build_sparse_encoder,
        open_client,
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question")
    parser.add_argument(
        "--locale",
        type=locale_arg,
        default=None,
        help="answer language (BCP-47 primary subtag, e.g. en/it/zh); "
        "default: detected from the question",
    )
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--no-rerank", action="store_true")
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    parser.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    args = parser.parse_args(argv)

    configure_cli_logging()
    locale = args.locale or detect_locale(args.question)

    # Fixed seed: the run-twice-identical gate must not rest on greedy decoding
    # alone; recorded in diario at Stage 9.
    completer = build_completer(
        env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0, seed=0
    )
    decision = route(args.question, completer)
    print(f"route: {decision.target} ({decision.reason})")

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)
    hits = search(
        client,
        # Retrieval runs on the rewritten query; generation below keeps the
        # student's original wording, which is what the answer must address.
        decision.query,
        dense,
        sparse,
        reranker,
        limit=args.top_k,
        collections=collections_for(decision),
    )
    client.close()

    streamer = build_streamer(env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0)
    for token in answer(args.question, hits, streamer, locale):
        print(token, end="", flush=True)
    print()

    if hits:
        print_sources(hits)
    else:
        print(pointer_line(locale))


if __name__ == "__main__":
    main()
