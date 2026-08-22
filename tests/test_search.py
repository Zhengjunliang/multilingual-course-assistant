"""Retrieval must honor the two-sided vector contract, apply payload filters
inside every prefetch branch (a top-level filter is silently ignored under
fusion — verified against the embedded Qdrant), and keep the reranker an
optional, swappable stage. All tests run offline on stub encoders."""

import subprocess
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from qdrant_client import QdrantClient
from test_index import StubDense, StubSparse, make_chunk

from rag.chunk import Chunk
from rag.index import (
    WEB_COLLECTION,
    DenseEncoder,
    SparseEncoder,
    ensure_collection,
    index_chunks,
    open_client,
)
from rag.search import (
    Hit,
    Reranker,
    hybrid_search,
    main,
    payload_filter,
    rerank_hits,
    round_robin,
    search,
)

BASE_DIR = Path(__file__).resolve().parent.parent

ORM_TEXT = "The Django ORM maps models to database tables."
SORT_TEXT = "Merge sort splits the array into halves."
MIGRAZIONI_TEXT = "Le migrazioni aggiornano lo schema del database."
TASSE_TEXT = "Le tasse universitarie si pagano tramite il portale online."
TASSE_URL = "https://www.unifi.it/it/studia-con-noi/tasse"


def make_web_chunk(index: int, text: str) -> Chunk:
    return make_chunk(index, text).model_copy(
        update={"kind": "web", "url": TASSE_URL, "ingest_source": "crawl"}
    )


@pytest.fixture
def client(tmp_path: Path) -> Iterator[QdrantClient]:
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    chunks = [
        make_chunk(0, ORM_TEXT),
        make_chunk(1, SORT_TEXT),
        make_chunk(2, MIGRAZIONI_TEXT, locale="it"),
    ]
    index_chunks(qdrant, chunks, StubDense(), StubSparse())
    yield qdrant
    qdrant.close()


class KeywordReranker:
    """Scores 1.0 when the query's first word appears in the text, else 0.0."""

    def rerank(self, query: str, texts: Sequence[str]) -> list[float]:
        keyword = query.lower().split()[0]
        return [1.0 if keyword in text.lower() else 0.0 for text in texts]


def test_hybrid_search_finds_the_matching_chunk(client: QdrantClient) -> None:
    hits = hybrid_search(client, ORM_TEXT, StubDense(), StubSparse(), limit=3)
    assert hits
    assert hits[0].chunk.text == ORM_TEXT
    assert hits[0].chunk.source_file == "deck.pdf"


def test_locale_filter_applies_to_both_prefetch_branches(client: QdrantClient) -> None:
    hits = hybrid_search(client, MIGRAZIONI_TEXT, StubDense(), StubSparse(), locale="it")
    assert hits
    assert all(hit.chunk.locale == "it" for hit in hits)
    hits = hybrid_search(client, MIGRAZIONI_TEXT, StubDense(), StubSparse(), locale="en")
    assert all(hit.chunk.locale == "en" for hit in hits)


def test_payload_filter_is_none_when_nothing_is_filtered() -> None:
    assert payload_filter(None, None) is None
    assert payload_filter("en", None) is not None


def test_rerank_replaces_scores_and_truncates() -> None:
    hits = [
        Hit(chunk=make_chunk(0, SORT_TEXT), score=0.9),
        Hit(chunk=make_chunk(1, ORM_TEXT), score=0.5),
    ]
    reranked = rerank_hits("django models", hits, KeywordReranker(), limit=1)
    assert [hit.chunk.text for hit in reranked] == [ORM_TEXT]
    assert reranked[0].score == 1.0


def test_rerank_of_no_hits_is_empty() -> None:
    assert rerank_hits("anything", [], KeywordReranker(), limit=5) == []


def test_search_without_reranker_keeps_fusion_order(client: QdrantClient) -> None:
    hits = search(client, ORM_TEXT, StubDense(), StubSparse(), None, limit=2)
    assert len(hits) <= 2
    assert hits[0].chunk.text == ORM_TEXT


def test_search_with_reranker_promotes_its_ranking(client: QdrantClient) -> None:
    hits = search(client, "django orm", StubDense(), StubSparse(), KeywordReranker(), limit=1)
    assert [hit.chunk.text for hit in hits] == [ORM_TEXT]


@pytest.fixture
def two_collection_client(tmp_path: Path) -> Iterator[QdrantClient]:
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    ensure_collection(qdrant, StubDense().dimension(), collection=WEB_COLLECTION)
    index_chunks(qdrant, [make_web_chunk(1, TASSE_TEXT)], StubDense(), StubSparse(), WEB_COLLECTION)
    yield qdrant
    qdrant.close()


def test_multi_collection_pool_reranks_across_both(two_collection_client: QdrantClient) -> None:
    hits = search(
        two_collection_client,
        "tasse universitarie",
        StubDense(),
        StubSparse(),
        KeywordReranker(),
        limit=1,
        collections=("slides", WEB_COLLECTION),
    )
    assert [hit.chunk.url for hit in hits] == [TASSE_URL]


def test_no_rerank_multi_collection_interleaves_round_robin(
    two_collection_client: QdrantClient,
) -> None:
    hits = search(
        two_collection_client,
        "database",
        StubDense(),
        StubSparse(),
        None,
        limit=2,
        collections=("slides", WEB_COLLECTION),
    )
    assert {hit.chunk.kind for hit in hits} == {"slides", "web"}  # one from each pool


def test_round_robin_interleaves_and_fills_the_remainder() -> None:
    first = [Hit(chunk=make_chunk(i, f"a{i}"), score=1.0) for i in range(3)]
    second = [Hit(chunk=make_chunk(9, "b0"), score=1.0)]
    ordered = round_robin([first, second], 3)
    assert [hit.chunk.text for hit in ordered] == ["a0", "b0", "a1"]
    assert round_robin([], 5) == []


class RecordingClient:
    """Captures the prefetch branches per collection; returns no points."""

    def __init__(self) -> None:
        self.prefetch_by_collection: dict[str, Any] = {}

    def query_points(self, collection: str, **kwargs: Any) -> Any:
        self.prefetch_by_collection[collection] = kwargs["prefetch"]
        return SimpleNamespace(points=[])


def condition_keys(prefetch: Any) -> list[str]:
    return [
        condition.key
        for branch in prefetch
        if branch.filter is not None
        for condition in branch.filter.must
    ]


def test_web_source_conditions_reach_only_the_unifi_web_branches() -> None:
    """ADR-1: `ingest_source` must land inside BOTH unifi_web prefetch
    branches (a top-level filter is ignored under fusion) and inside NONE of
    the slides branches."""
    recorder = RecordingClient()
    search(
        cast("QdrantClient", recorder),
        "query",
        StubDense(),
        StubSparse(),
        None,
        collections=("slides", WEB_COLLECTION),
        ingest_source="crawl",
    )
    web_keys = condition_keys(recorder.prefetch_by_collection[WEB_COLLECTION])
    assert web_keys.count("ingest_source") == 2  # dense branch + sparse branch
    assert "ingest_source" not in condition_keys(recorder.prefetch_by_collection["slides"])


def test_slides_hits_are_unchanged_by_web_source_conditions(client: QdrantClient) -> None:
    baseline = search(client, ORM_TEXT, StubDense(), StubSparse(), None, limit=3)
    with_source = search(
        client, ORM_TEXT, StubDense(), StubSparse(), None, limit=3, ingest_source="crawl"
    )
    assert with_source == baseline


def test_cli_prints_ranked_citations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    qdrant.close()

    def stub_dense(model_name: str) -> DenseEncoder:
        return StubDense()

    def stub_sparse() -> SparseEncoder:
        return StubSparse()

    def stub_reranker(model_name: str) -> Reranker:
        return KeywordReranker()

    monkeypatch.setattr("rag.search.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.search.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.search.build_reranker", stub_reranker)

    main(["django orm", "--qdrant-path", str(qdrant_path), "--top-k", "1"])
    out = capsys.readouterr().out
    assert "deck.pdf p.1" in out
    assert "Algorithms" in out

    main([ORM_TEXT, "--qdrant-path", str(qdrant_path), "--no-rerank", "--locale", "en"])
    assert "deck.pdf p.1" in capsys.readouterr().out


def test_importing_search_loads_none_of_the_heavy_dependencies() -> None:
    code = (
        "import rag.search, sys; "
        "print(any(m in sys.modules for m in "
        "('qdrant_client', 'fastembed', 'sentence_transformers', 'torch')))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"
