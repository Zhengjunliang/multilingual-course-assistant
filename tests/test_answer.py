"""Generation must stay grounded: the prompt carries the retrieved excerpts
with their citation markers, an empty candidate set short-circuits into a
refusal without ever calling the LLM, and the OpenAI client stays behind a
protocol so every test runs offline."""

import subprocess
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from test_index import StubDense, StubSparse, make_chunk
from test_search import ORM_TEXT

from rag.answer import Message, answer, build_messages, format_context, main, source_marker
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
