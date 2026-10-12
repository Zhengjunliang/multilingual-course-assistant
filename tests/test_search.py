"""Retrieval must honor the two-sided vector contract, apply payload filters
to both branches, rank equal scores the same way whatever order the server
returns them in, and keep the reranker an optional, swappable stage. All tests
run offline on stub encoders."""

import inspect
import subprocess
import sys
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest
from qdrant_client import QdrantClient, models
from test_index import StubDense, StubSparse, make_chunk

from rag.chunk import Chunk, EditionKey, chunk_id_of
from rag.index import (
    COLLECTION,
    DENSE_VECTOR,
    SPARSE_VECTOR,
    WEB_COLLECTION,
    DenseEncoder,
    SparseEncoder,
    SparseVector,
    ensure_collection,
    index_chunks,
    open_client,
    point_id_of,
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
        update={
            "kind": "web",
            "course": "unifi",
            "academic_year": None,
            "url": TASSE_URL,
            "ingest_source": "crawl",
        }
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


def test_locale_filter_applies_to_both_prefetch_branches(client: QdrantClient) -> None:
    hits = hybrid_search(
        client, MIGRAZIONI_TEXT, StubDense(), StubSparse(), scope=None, locale="it"
    )
    assert hits
    assert all(hit.chunk.locale == "it" for hit in hits)
    hits = hybrid_search(
        client, MIGRAZIONI_TEXT, StubDense(), StubSparse(), scope=None, locale="en"
    )
    assert all(hit.chunk.locale == "en" for hit in hits)


def test_rerank_replaces_scores_and_sorts_the_whole_pool() -> None:
    hits = [
        Hit(chunk=make_chunk(0, SORT_TEXT), score=0.9),
        Hit(chunk=make_chunk(1, ORM_TEXT), score=0.5),
    ]
    reranked = rerank_hits("django models", hits, KeywordReranker())
    assert [hit.chunk.text for hit in reranked] == [ORM_TEXT, SORT_TEXT]
    assert [hit.score for hit in reranked] == [1.0, 0.0]


def test_rerank_of_no_hits_is_empty() -> None:
    assert rerank_hits("anything", [], KeywordReranker()) == []


def test_search_without_reranker_keeps_fusion_order(client: QdrantClient) -> None:
    hits = search(client, ORM_TEXT, StubDense(), StubSparse(), None, scope=None, limit=2)
    assert len(hits) <= 2
    assert hits[0].chunk.text == ORM_TEXT


class FixedQuery:
    """Encodes every query to the same vectors, so the test can place each
    point at the rank it needs in each branch."""

    def dimension(self) -> int:
        return 4

    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError

    def encode_query(self, text: str) -> list[float]:
        return [1.0, 0.0, 0.0, 0.0]


class FixedSparseQuery:
    def encode_documents(self, texts: Sequence[str]) -> list[SparseVector]:
        raise NotImplementedError

    def encode_query(self, text: str) -> SparseVector:
        return ([1], [1.0])


VectorRow = tuple[Chunk, list[float], models.SparseVector]


def vector_client(tmp_path: Path, rows: Sequence[VectorRow]) -> QdrantClient:
    """An index whose points carry the vectors given, so a test can place each
    point at the rank it needs in each branch under `FixedQuery`."""
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, FixedQuery().dimension())
    qdrant.upsert(
        COLLECTION,
        [
            models.PointStruct(
                id=point_id_of(chunk.chunk_id),
                vector={DENSE_VECTOR: dense, SPARSE_VECTOR: sparse},
                payload=chunk.model_dump(),
            )
            for chunk, dense, sparse in rows
        ],
    )
    return qdrant


def ties_reversed(real: Callable[..., Any], branches: list[str]) -> Callable[..., Any]:
    """A stand-in for `query_points` that answers the way a Qdrant server
    searching its segments in parallel may: best score first, equal scores in
    the reverse of the index's order, cut to the limit it is asked for. It
    records the vector each request searched."""

    def query_points(*args: Any, limit: int, using: str, **kwargs: Any) -> Any:
        branches.append(using)
        response = real(*args, limit=100, using=using, **kwargs)
        points = response.points
        order = sorted(range(len(points)), key=lambda i: (-points[i].score, -i))
        return response.model_copy(update={"points": [points[i] for i in order][:limit]})

    return query_points


def by_point_id(chunks: Sequence[Chunk]) -> list[str]:
    return [chunk.chunk_id for chunk in sorted(chunks, key=lambda c: point_id_of(c.chunk_id))]


TIED = (make_chunk(0, ORM_TEXT), make_chunk(1, SORT_TEXT))


@pytest.fixture
def tied_client(tmp_path: Path) -> Iterator[QdrantClient]:
    """Two points with one fused score, and a third below them: RRF scores
    ranks, so a point first in one branch and second in the other ties with its
    mirror image."""
    qdrant = vector_client(
        tmp_path,
        [
            # dense rank 1, sparse rank 2
            (TIED[0], [1.0, 0.1, 0.0, 0.0], models.SparseVector(indices=[1], values=[1.0])),
            # dense rank 2, sparse rank 1
            (TIED[1], [1.0, 0.3, 0.0, 0.0], models.SparseVector(indices=[1], values=[2.0])),
            # dense rank 3 only
            (make_chunk(2), [0.0, 0.0, 1.0, 0.0], models.SparseVector(indices=[3], values=[1.0])),
        ],
    )
    yield qdrant
    qdrant.close()


def test_equal_fusion_scores_rank_by_point_id_whatever_order_the_server_returns(
    tied_client: QdrantClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def ranked(limit: int) -> list[str]:
        hits = hybrid_search(
            tied_client, "q", FixedQuery(), FixedSparseQuery(), scope=None, limit=limit
        )
        return [hit.chunk.chunk_id for hit in hits]

    as_stored = ranked(1), ranked(3)
    branches: list[str] = []
    monkeypatch.setattr(
        tied_client, "query_points", ties_reversed(tied_client.query_points, branches)
    )
    assert (ranked(1), ranked(3)) == as_stored
    assert set(branches) == {DENSE_VECTOR, SPARSE_VECTOR}
    assert as_stored[1][:2] == by_point_id(TIED)


TWINS = (make_chunk(0, ORM_TEXT), make_chunk(1, ORM_TEXT))


@pytest.fixture
def twin_client(tmp_path: Path) -> Iterator[QdrantClient]:
    """One text under two addresses: two points with the same vectors, so they
    tie inside each branch, and a third below them in both."""
    twin_dense = [1.0, 0.0, 0.0, 0.0]
    qdrant = vector_client(
        tmp_path,
        [
            *((twin, twin_dense, models.SparseVector(indices=[1], values=[2.0])) for twin in TWINS),
            (make_chunk(2), [1.0, 1.0, 0.0, 0.0], models.SparseVector(indices=[1], values=[1.0])),
        ],
    )
    yield qdrant
    qdrant.close()


def test_a_tie_at_a_branch_cut_keeps_the_lower_point_id_whatever_order_the_server_returns(
    twin_client: QdrantClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The branch keeps one point of the two, so which one may not depend on the
    order the server returns the tie in; the request has to reach past the tie
    to know where it ends."""

    def kept() -> list[str]:
        hits = hybrid_search(
            twin_client,
            "q",
            FixedQuery(),
            FixedSparseQuery(),
            scope=None,
            limit=1,
            prefetch_limit=1,
        )
        return [hit.chunk.chunk_id for hit in hits]

    as_stored = kept()
    branches: list[str] = []
    monkeypatch.setattr(
        twin_client, "query_points", ties_reversed(twin_client.query_points, branches)
    )
    assert kept() == as_stored == by_point_id(TWINS)[:1]
    assert set(branches) == {DENSE_VECTOR, SPARSE_VECTOR}


def test_client_fusion_ranks_and_scores_like_qdrant_rrf_when_nothing_ties(tmp_path: Path) -> None:
    """The fusion moved from the server to the client (`fuse_rrf`); without
    ties both must give the same order and the same scores."""
    chunks = [make_chunk(index) for index in range(4)]
    # dense order 0 1 2 3, sparse order 2 0 1: fused 0 2 1 3, no two scores equal
    qdrant = vector_client(
        tmp_path,
        [
            (chunks[0], [1.0, 0.0, 0.0, 0.0], models.SparseVector(indices=[1], values=[2.0])),
            (chunks[1], [1.0, 0.5, 0.0, 0.0], models.SparseVector(indices=[1], values=[1.0])),
            (chunks[2], [1.0, 1.0, 0.0, 0.0], models.SparseVector(indices=[1], values=[3.0])),
            (chunks[3], [0.5, 1.0, 0.0, 0.0], models.SparseVector(indices=[2], values=[1.0])),
        ],
    )
    hits = hybrid_search(qdrant, "q", FixedQuery(), FixedSparseQuery(), scope=None, limit=4)
    server = qdrant.query_points(
        COLLECTION,
        prefetch=[
            models.Prefetch(query=FixedQuery().encode_query("q"), using=DENSE_VECTOR, limit=20),
            models.Prefetch(
                query=models.SparseVector(indices=[1], values=[1.0]), using=SPARSE_VECTOR, limit=20
            ),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=4,
        with_payload=True,
    ).points
    qdrant.close()

    assert [hit.chunk.chunk_id for hit in hits] == [chunks[i].chunk_id for i in (0, 2, 1, 3)]
    assert [(hit.chunk.chunk_id, hit.score) for hit in hits] == [
        (Chunk.model_validate(point.payload).chunk_id, pytest.approx(point.score))
        for point in server
    ]


def test_search_with_reranker_promotes_its_ranking(client: QdrantClient) -> None:
    hits = search(
        client, "django orm", StubDense(), StubSparse(), KeywordReranker(), scope=None, limit=1
    )
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
        scope=None,
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
        scope=None,
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


def test_web_source_conditions_reach_only_the_unifi_web_branches(
    two_collection_client: QdrantClient,
) -> None:
    """The eval-isolation rule (docs/architecture.md): a crawl-only search must
    not see the live version of a page, so `ingest_source` filters BOTH
    unifi_web branches — one unfiltered branch lets the live version back into
    the fused list — and NONE of the slides branches, whose chunks carry no
    source."""
    live = make_web_chunk(2, TASSE_TEXT).model_copy(update={"ingest_source": "live"})
    index_chunks(two_collection_client, [live], StubDense(), StubSparse(), WEB_COLLECTION)

    hits = search(
        two_collection_client,
        TASSE_TEXT,
        StubDense(),
        StubSparse(),
        None,
        scope=None,
        collections=("slides", WEB_COLLECTION),
        ingest_source="crawl",
    )

    assert [hit.chunk.ingest_source for hit in hits if hit.chunk.kind == "web"] == ["crawl"]
    assert [hit.chunk.text for hit in hits if hit.chunk.kind == "slides"] == [ORM_TEXT]


def test_slides_hits_are_unchanged_by_web_source_conditions(client: QdrantClient) -> None:
    baseline = search(client, ORM_TEXT, StubDense(), StubSparse(), None, scope=None, limit=3)
    with_source = search(
        client,
        ORM_TEXT,
        StubDense(),
        StubSparse(),
        None,
        scope=None,
        limit=3,
        ingest_source="crawl",
    )
    assert with_source == baseline


@pytest.mark.parametrize(
    "function",
    [payload_filter, hybrid_search, search],
    ids=["payload_filter", "hybrid_search", "search"],
)
def test_scope_is_keyword_only_without_default(function: Callable[..., object]) -> None:
    """pyright catches a call that forgets `scope`; it cannot catch a default
    that makes forgetting it legal, and silently unrestricted."""
    parameter = inspect.signature(function).parameters["scope"]
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty


THIS_YEAR = EditionKey("B028451", "2025-2026")
LAST_YEAR = EditionKey("B028451", "2024-2025")


@pytest.mark.parametrize(
    ("scope", "editions"),
    [
        (None, {THIS_YEAR, LAST_YEAR}),
        ([THIS_YEAR], {THIS_YEAR}),
        ([THIS_YEAR, LAST_YEAR], {THIS_YEAR, LAST_YEAR}),
        ([], set()),
    ],
    ids=["unrestricted", "one", "any-of-two", "empty"],
)
def test_scope_decides_which_slides_editions_a_search_sees(
    two_collection_client: QdrantClient,
    scope: list[EditionKey] | None,
    editions: set[EditionKey],
) -> None:
    """The scope filters both slides branches and no web one: in one slides
    branch alone the other edition leaks back into the fused list; in the web
    branches no page matches it, and campus answers vanish. `[]` sees no slides
    at all, never every edition."""
    last_year = make_chunk(0, ORM_TEXT)
    last_year = last_year.model_copy(
        update={
            "academic_year": LAST_YEAR.academic_year,
            "chunk_id": chunk_id_of(
                LAST_YEAR, last_year.source_sha256, last_year.parse_variant, last_year.chunk_index
            ),
        }
    )
    index_chunks(two_collection_client, [last_year], StubDense(), StubSparse())

    hits = search(
        two_collection_client,
        ORM_TEXT,
        StubDense(),
        StubSparse(),
        None,
        scope=scope,
        collections=("slides", WEB_COLLECTION),
    )

    seen = {
        (hit.chunk.course, hit.chunk.academic_year) for hit in hits if hit.chunk.kind == "slides"
    }
    assert seen == editions
    assert [hit.chunk.url for hit in hits if hit.chunk.kind == "web"] == [TASSE_URL]


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

    main(["django orm", "--qdrant", str(qdrant_path), "--top-k", "1"])
    out = capsys.readouterr().out
    assert "deck.pdf p.1" in out
    assert "Algorithms" in out

    main([ORM_TEXT, "--qdrant", str(qdrant_path), "--no-rerank", "--locale", "en"])
    assert "deck.pdf p.1" in capsys.readouterr().out

    main([ORM_TEXT, "--qdrant", str(qdrant_path), "--no-rerank", "--scope", "B028451:2025-2026"])
    assert "deck.pdf p.1" in capsys.readouterr().out

    # A malformed edition stops at the flag, before any model or index opens.
    for value, reason in (("B003725", "expected CODE:YEAR"), ("B028451:2025/2026", "invariant 1")):
        with pytest.raises(SystemExit):
            main([ORM_TEXT, "--qdrant", str(qdrant_path), "--scope", value])
        assert reason in capsys.readouterr().err


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
