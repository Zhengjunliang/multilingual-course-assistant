"""Answer generation: retrieved chunks -> grounded, cited answer from Qwen3.

Generation talks to any OpenAI-compatible endpoint (`config/env.py`): the dev
default is a local Ollama instance (Qwen3-4B quant); M3 experiments switch the
base URL to the MICC vLLM tunnel. What travels is the prompt — question plus
the retrieved chunk texts — never files or the index.

    uv run python -m rag.answer "What is an ORM?"
    uv run python -m rag.answer "Cosa sono le migrazioni?" --locale it --no-rerank
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from rag.chunk import detect_locale, locale_arg
from rag.llm import ChatStreamer, Message, build_streamer
from rag.probe import configure_cli_logging
from rag.search import (
    DEFAULT_RERANK_MODEL,
    Hit,
    build_reranker,
    search,
)

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

logger = logging.getLogger(__name__)

LOCALE_NAMES = {"en": "English", "it": "Italian", "zh": "Chinese"}

SYSTEM_PROMPT = """\
You are a course assistant answering questions about university course material.

Rules:
- Answer ONLY from the numbered excerpts provided by the user. Do not use outside knowledge.
- Cite every claim by copying the bracketed source marker of its excerpt EXACTLY, \
character for character. Never shorten a marker, never invent one, and never \
write "Excerpt N" — the marker is the [...] label shown next to the excerpt.
- If the excerpts do not contain the answer, say so plainly instead of guessing.
- Answer in {language}.
- Be concise: a student wants the concept, not an essay."""


def source_marker(hit: Hit) -> str:
    """Web chunks cite by URL and fetch date (the page a student can open);
    slides keep file + page. The Sources footer downstream renders the same
    markers, so this is the single citation shape for both collections."""
    if hit.chunk.kind == "web" and hit.chunk.url:
        date = f" · {hit.chunk.fetch_date}" if hit.chunk.fetch_date else ""
        return f"[{hit.chunk.url}{date}]"
    return f"[{hit.chunk.source_file} p.{hit.chunk.page}]"


def format_context(hits: Sequence[Hit]) -> str:
    """Number the excerpts and tag each with the citation marker the model is
    told to reuse; raw `text` is what the user could be shown, so it is also
    what claims are grounded on."""
    blocks = [
        f"Excerpt {number} {source_marker(hit)}:\n{hit.chunk.text}"
        for number, hit in enumerate(hits, start=1)
    ]
    return "\n\n".join(blocks)


def build_messages(question: str, hits: Sequence[Hit], locale: str) -> list[Message]:
    language = LOCALE_NAMES.get(locale, "the language of the question")
    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(language=language)},
        {"role": "user", "content": f"{format_context(hits)}\n\nQuestion: {question}"},
    ]


def answer(
    question: str, hits: Sequence[Hit], streamer: ChatStreamer, locale: str
) -> Iterator[str]:
    """No grounding, no LLM call: an empty candidate set becomes an honest
    refusal instead of an invitation to hallucinate."""
    if not hits:
        yield {
            "it": "Non ho trovato materiale del corso pertinente a questa domanda.",
        }.get(locale, "I could not find course material relevant to this question.")
        return
    yield from streamer.stream(build_messages(question, hits, locale))


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

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)
    hits = search(client, args.question, dense, sparse, reranker, limit=args.top_k)
    client.close()

    streamer = build_streamer(env.llm_base_url, env.llm_api_key, env.llm_model)
    for token in answer(args.question, hits, streamer, locale):
        print(token, end="", flush=True)
    print()

    if hits:
        print("\nSources:")
        seen: list[str] = []
        for hit in hits:
            marker = source_marker(hit)
            if marker not in seen:
                seen.append(marker)
                print(f"  {marker}")


if __name__ == "__main__":
    main()
