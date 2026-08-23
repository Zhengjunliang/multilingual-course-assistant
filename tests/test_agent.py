"""Routing is a 4B model's decision, so what the tests pin is the contract that
makes it safe: an unusable reply routes to `both` instead of raising, a target
maps to real collection names, and an empty retrieval refuses with the pointer
that lets a student grow the knowledge base. All of it runs offline on stubs —
no endpoint, no models."""

from collections.abc import Sequence
from pathlib import Path
from typing import Literal

import pytest
from test_answer import StubStreamer
from test_index import StubDense, StubSparse, make_chunk
from test_llm import StubCompleter
from test_search import ORM_TEXT

from rag.agent import RouteDecision, collections_for, main, pointer_line, route
from rag.index import COLLECTION, WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.llm import Message

SLIDES_REPLY = '{"target": "slides", "query": "ORM definition", "fresh": false, "reason": "course"}'


class ScriptedCompleter:
    """One canned reply per call, in order: the router sees one question at a
    time, so a report over N questions needs N scripted replies."""

    def __init__(self, replies: Sequence[str]) -> None:
        self.replies = list(replies)
        self.questions: list[str] = []

    def complete(self, messages: Sequence[Message]) -> str:
        self.questions.append(messages[-1]["content"])
        return self.replies.pop(0)


def make_decision(target: Literal["slides", "unifi_web", "both"]) -> RouteDecision:
    return RouteDecision(target=target, query="q", fresh=False, reason="r")


def test_unparseable_reply_falls_back_to_both() -> None:
    """The fallback is the frozen contract: both collections cost latency, a
    raised exception costs the answer."""
    decision = route("Quando scadono le tasse?", StubCompleter("sorry, I cannot do JSON"))
    assert decision.target == "both"
    assert decision.query == "Quando scadono le tasse?"  # untouched question, not a rewrite
    assert decision.fresh is False
    assert decision.reason.startswith("fallback")


def test_valid_reply_round_trips_every_field() -> None:
    completer = StubCompleter(
        '{"target": "unifi_web", "query": "scadenza tasse universitarie", '
        '"fresh": true, "reason": "administrative deadline"}'
    )
    decision = route("Quando scadono le tasse?", completer)
    assert decision.target == "unifi_web"
    assert decision.query == "scadenza tasse universitarie"
    assert decision.fresh is True
    assert decision.reason == "administrative deadline"
    assert completer.messages[-1]["content"] == "Quando scadono le tasse?"


def test_reply_without_fresh_still_validates() -> None:
    """`fresh` has no consumer before the deepening loop, so a 4B model dropping
    it must cost the flag, not the whole routing decision."""
    completer = StubCompleter('{"target": "slides", "query": "ORM", "reason": "course topic"}')
    decision = route("What is an ORM?", completer)
    assert decision.target == "slides"
    assert decision.fresh is False


def test_collections_for_maps_each_target_to_real_collection_names() -> None:
    assert collections_for(make_decision("slides")) == (COLLECTION,)
    assert collections_for(make_decision("unifi_web")) == (WEB_COLLECTION,)
    assert collections_for(make_decision("both")) == (COLLECTION, WEB_COLLECTION)


@pytest.fixture
def empty_index(tmp_path: Path) -> Path:
    """A real slides collection with nothing in it — retrieval succeeds and
    returns no candidate, which is the branch under test."""
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    qdrant.close()
    return qdrant_path


@pytest.mark.parametrize(
    ("locale", "refusal", "pointer"),
    [
        ("en", "could not find", "If you paste the URL"),
        ("it", "Non ho trovato", "Se mi incolli l'URL"),
    ],
)
def test_empty_retrieval_refuses_then_points_to_a_url(
    locale: str,
    refusal: str,
    pointer: str,
    empty_index: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    def stub_completer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0, seed: int | None = None
    ) -> StubCompleter:
        assert (temperature, seed) == (0.0, 0)  # routing is pinned: greedy plus a fixed seed
        return StubCompleter(SLIDES_REPLY)

    def stub_streamer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0
    ) -> StubStreamer:
        return StubStreamer()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.agent.build_completer", stub_completer)
    monkeypatch.setattr("rag.agent.build_streamer", stub_streamer)

    main(
        [
            "What is an ORM?",
            "--locale",
            locale,
            "--qdrant-path",
            str(empty_index),
            "--no-rerank",
        ]
    )
    out = capsys.readouterr().out
    assert "route: slides (course)" in out
    assert refusal in out
    assert pointer in out
    assert "Sources:" not in out  # nothing was retrieved, so nothing may be cited


def test_cli_answers_from_the_routed_collection_with_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The routed query drives retrieval, the original question drives
    generation: the model must answer what the student actually asked."""
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    qdrant.close()

    streamer = StubStreamer()

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    def stub_completer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0, seed: int | None = None
    ) -> StubCompleter:
        assert (temperature, seed) == (0.0, 0)  # routing is pinned: greedy plus a fixed seed
        return StubCompleter(SLIDES_REPLY)

    def stub_streamer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0
    ) -> StubStreamer:
        return streamer

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.agent.build_completer", stub_completer)
    monkeypatch.setattr("rag.agent.build_streamer", stub_streamer)

    main(["What is an ORM?", "--qdrant-path", str(qdrant_path), "--no-rerank"])
    out = capsys.readouterr().out
    assert "An ORM maps objects to tables" in out
    assert "Sources:" in out
    assert "[deck.pdf p.1]" in out
    assert streamer.messages[-1]["content"].endswith("Question: What is an ORM?")


def test_pointer_line_covers_every_declared_locale() -> None:
    """Campus gold is roughly a third Chinese: a zh question that fell back to
    the English pointer would be a refusal the student cannot act on."""
    assert pointer_line("it").startswith("Se mi incolli")
    assert pointer_line("zh").startswith("把包含答案的网页链接")
    assert pointer_line("de") == pointer_line("en")  # unknown locales keep the English pointer
