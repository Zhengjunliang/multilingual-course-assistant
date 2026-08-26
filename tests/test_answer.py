"""Generation must stay grounded: the prompt carries the retrieved excerpts
with their citation markers, an empty candidate set short-circuits into a
refusal without ever calling the LLM, and the OpenAI client stays behind a
protocol so every test runs offline."""

import hashlib
import subprocess
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from test_index import StubDense, StubSparse, make_chunk
from test_search import ORM_TEXT

from rag.answer import (
    HISTORY_ANSWER_CHARS,
    SYSTEM_PROMPT,
    Message,
    Turn,
    answer,
    build_messages,
    format_context,
    main,
    source_marker,
)
from rag.index import ensure_collection, index_chunks, open_client
from rag.search import Hit

BASE_DIR = Path(__file__).resolve().parent.parent


class StubStreamer:
    def __init__(self) -> None:
        self.messages: list[Message] = []

    def stream(self, messages: Sequence[Message]) -> Iterator[str]:
        self.messages = list(messages)
        yield from ("An ORM ", "maps objects to tables ", "[deck.pdf p.1]")


def make_hits() -> list[Hit]:
    return [Hit(chunk=make_chunk(0, ORM_TEXT), score=0.9)]


def test_context_numbers_excerpts_and_tags_citation_markers() -> None:
    context = format_context(make_hits())
    assert context.startswith("Excerpt 1 [deck.pdf p.1]:")
    assert ORM_TEXT in context


def test_messages_carry_the_answer_language_and_the_question() -> None:
    messages = build_messages("What is an ORM?", make_hits(), "it")
    assert messages[0]["role"] == "system"
    assert "Italian" in messages[0]["content"]
    assert messages[1]["content"].endswith("Question: What is an ORM?")


# The prompt every generation-side result in docs/diario-sperimentale.md was
# produced with. Same reasoning as the router's pin in tests/test_agent.py: the
# identity tests below compare new code against new code, so without this a
# prompt edit retires those results while every test stays green.
GENERATION_PROMPT_SHA256 = "1706cf3f6bf211179d31c73c8a7b1d50148f3a4281b3824c759f316464160d0d"


def test_the_generation_prompt_is_the_one_the_recorded_answers_were_produced_with() -> None:
    assert hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest() == GENERATION_PROMPT_SHA256


def test_a_question_with_no_history_builds_exactly_the_prompt_it_did_before() -> None:
    hits = make_hits()

    assert build_messages("What is an ORM?", hits, "it") == build_messages(
        "What is an ORM?", hits, "it", ()
    )


def test_history_never_becomes_extra_messages() -> None:
    """Two messages, however long the conversation.

    Real `assistant` turns would show a 4B model what an assistant reply looks
    like here — and the same model is asked for bare JSON when it routes
    (rag/agent.py). Both call sites keep the same shape so that neither can
    teach it the other's habits.
    """
    messages = build_messages(
        "How does it differ?",
        make_hits(),
        "en",
        [Turn(question="What is an ORM?", answer="It maps objects to tables.")],
    )

    assert [message["role"] for message in messages] == ["system", "user"]


def test_history_comes_before_the_excerpts_and_the_question() -> None:
    """Order is the grounding rule: whatever the answer must be built from is
    the last thing the model reads before what it is being asked."""
    content = build_messages(
        "How does it differ?",
        make_hits(),
        "en",
        [Turn(question="What is an ORM?", answer="It maps objects to tables.")],
    )[1]["content"]

    assert content.index("What is an ORM?") < content.index("Excerpt 1")
    assert content.endswith("Question: How does it differ?")


def test_an_earlier_answer_arrives_without_its_citation_markers() -> None:
    """A marker names an excerpt that is not in front of the model this turn.
    Left in, it is a label to copy into a citation that resolves to nothing."""
    content = build_messages(
        "And the second one?",
        make_hits(),
        "en",
        [Turn(question="What is an ORM?", answer="It maps objects [deck.pdf p.1] to tables.")],
    )[1]["content"]

    assert "It maps objects to tables." in content
    # `Excerpt 1 [deck.pdf p.1]` is this turn's own, and must survive.
    assert content.count("[deck.pdf p.1]") == 1


def test_a_long_earlier_answer_is_truncated() -> None:
    """Three whole answers would crowd out the excerpts this turn is grounded
    in — the one thing in the prompt that must not be squeezed."""
    content = build_messages(
        "And?",
        make_hits(),
        "en",
        [Turn(question="Explain ORMs.", answer="word " * 500)],
    )[1]["content"]

    assert "…" in content
    assert content.index("Excerpt 1") < HISTORY_ANSWER_CHARS + 200


def test_answer_streams_through_the_client() -> None:
    streamer = StubStreamer()
    tokens = list(answer("What is an ORM?", make_hits(), streamer, "en"))
    assert "".join(tokens).startswith("An ORM maps")
    assert streamer.messages  # the prompt actually reached the client


def test_no_hits_refuses_in_the_question_language_without_calling_the_llm() -> None:
    streamer = StubStreamer()
    (english,) = list(answer("What is an ORM?", [], streamer, "en"))
    (italian,) = list(answer("Cosa è un ORM?", [], streamer, "it"))
    assert "could not find" in english
    assert "Non ho trovato" in italian
    assert streamer.messages == []


def test_cli_answers_end_to_end_with_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    qdrant.close()

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    def stub_streamer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0
    ) -> StubStreamer:
        assert temperature == 0.0  # decoding stays greedy: two runs, one answer
        return StubStreamer()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.answer.build_streamer", stub_streamer)

    main(["django orm", "--qdrant-path", str(qdrant_path), "--no-rerank"])
    out = capsys.readouterr().out
    assert "An ORM maps objects to tables" in out
    assert "Sources:" in out
    assert "[deck.pdf p.1]" in out


def test_source_marker_matches_the_prompt_citation_format() -> None:
    assert source_marker(make_hits()[0]) == "[deck.pdf p.1]"


def test_importing_answer_loads_none_of_the_heavy_dependencies() -> None:
    code = (
        "import rag.answer, sys; "
        "print(any(m in sys.modules for m in "
        "('openai', 'qdrant_client', 'fastembed', 'sentence_transformers', 'torch')))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"
