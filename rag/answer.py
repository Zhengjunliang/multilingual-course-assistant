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
import re
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

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

# How much of an earlier answer travels with the next question. Long enough to
# carry what a pronoun could be pointing at, short enough that three of them do
# not crowd out the excerpts this turn is actually grounded on.
HISTORY_ANSWER_CHARS = 400

# Anything bracketed, not the two marker shapes specifically. Over-removal is
# the safe direction: what is being prevented is the model copying a marker that
# belonged to a previous turn's excerpts, which are not in front of it now, and
# a bracketed aside lost from a truncated old answer costs nothing.
_BRACKETED = re.compile(r"\[[^\]]*\]")

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


class Turn(BaseModel):
    """One completed exchange, as plain data.

    A model of its own rather than the database row it will usually be built
    from: `rag/` may not import Django (tests/test_smoke.py enforces it), and
    the web layer is not the only conceivable caller. Frozen like every other
    contract here — a prompt built from a history that something mutated
    mid-call would be unreproducible.
    """

    model_config = ConfigDict(frozen=True)

    question: str
    answer: str


def format_history_questions(turns: Sequence[Turn]) -> str:
    """What the router sees: the student's own earlier questions, nothing else.

    The antecedent of "it" is in what the student said last, not in what they
    were told — and an earlier answer is full of citation markers, three turns
    of which would tug every later routing decision towards `unifi_web`.
    """
    asked = "\n".join(f"- {turn.question}" for turn in turns)
    return f"Earlier questions in this conversation, oldest first:\n{asked}"


def format_history(turns: Sequence[Turn]) -> str:
    """What generation sees: whole exchanges, trimmed and stripped of markers.

    Both edits are about the citation rule the system prompt states. A marker
    left in an old answer is a label the model can copy while the excerpt behind
    it is nowhere in this turn's context, which is a citation that resolves to
    nothing; removing them leaves history as prose to refer back to and nothing
    to cite from.
    """
    blocks = [
        f"Student: {turn.question}\nAssistant: {_shorten(_BRACKETED.sub('', turn.answer))}"
        for turn in turns
    ]
    return "Earlier in this conversation, oldest first:\n\n" + "\n\n".join(blocks)


def _shorten(text: str) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= HISTORY_ANSWER_CHARS:
        return collapsed
    return collapsed[:HISTORY_ANSWER_CHARS].rstrip() + "…"


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


def build_messages(
    question: str, hits: Sequence[Hit], locale: str, history: Sequence[Turn] = ()
) -> list[Message]:
    """The prompt, as two messages — and two only, however long the conversation.

    History is a text block inside the same user message rather than a run of
    alternating turns. Real `assistant` messages would be a demonstration to a
    4B model of what an assistant reply looks like here, and `rag/agent.py` asks
    the same model for strict JSON; the shape is kept identical on both sides so
    that neither can teach it the other's habits.

    It sits ahead of the excerpts so that what the answer must be grounded in is
    the last thing before the question. With no history the two messages are
    byte for byte what they were before conversations existed, which is what
    keeps the M3 measurements comparable.
    """
    language = LOCALE_NAMES.get(locale, "the language of the question")
    earlier = f"{format_history(history)}\n\n" if history else ""
    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(language=language)},
        {"role": "user", "content": f"{earlier}{format_context(hits)}\n\nQuestion: {question}"},
    ]


def answer(
    question: str,
    hits: Sequence[Hit],
    streamer: ChatStreamer,
    locale: str,
    history: Sequence[Turn] = (),
) -> Iterator[str]:
    """No grounding, no LLM call: an empty candidate set becomes an honest
    refusal instead of an invitation to hallucinate."""
    if not hits:
        yield {
            "it": "Non ho trovato materiale del corso pertinente a questa domanda.",
        }.get(locale, "I could not find course material relevant to this question.")
        return
    yield from streamer.stream(build_messages(question, hits, locale, history))


def print_sources(hits: Sequence[Hit]) -> None:
    """The footer every CLI prints under an answer (callers skip it when there
    is nothing to cite): each distinct marker once, in retrieval order, in the
    exact shape the model was told to cite."""
    print("\nSources:")
    seen: list[str] = []
    for hit in hits:
        marker = source_marker(hit)
        if marker not in seen:
            seen.append(marker)
            print(f"  {marker}")


def main(argv: list[str] | None = None) -> None:
    from config.env import env
    from rag.index import (
        COLLECTION,
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
    parser.add_argument(
        "--collection",
        action="append",
        default=None,
        help="collection to retrieve from; repeat for a merged pool (default: slides). "
        "The M2.5b agent router will pick this automatically",
    )
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    parser.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    args = parser.parse_args(argv)

    configure_cli_logging()
    locale = args.locale or detect_locale(args.question)

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)
    hits = search(
        client,
        args.question,
        dense,
        sparse,
        reranker,
        limit=args.top_k,
        collections=tuple(args.collection) if args.collection else (COLLECTION,),
    )
    client.close()

    # Greedy decoding is stated here rather than inherited: the same question
    # must produce the same answer across two runs of a gate (rag/llm.py).
    streamer = build_streamer(env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0)
    for token in answer(args.question, hits, streamer, locale):
        print(token, end="", flush=True)
    print()

    if hits:
        print_sources(hits)


if __name__ == "__main__":
    main()
