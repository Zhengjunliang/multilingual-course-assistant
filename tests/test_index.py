"""Indexing must be idempotent and payload-complete: whatever goes into Qdrant
is all that retrieval will ever have. All tests run offline — stub encoders and
an embedded Qdrant under tmp_path stand in for the real models and store."""

import subprocess
import sys
import zlib
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from rag.chunk import Chunk, Locale
from rag.index import (
    COLLECTION,
    DenseEncoder,
    SparseEncoder,
    SparseVector,
    collect_chunk_files,
    ensure_collection,
    index_chunks,
    load_chunks,
    main,
    open_client,
    point_id_of,
)

BASE_DIR = Path(__file__).resolve().parent.parent


class StubDense:
    def dimension(self) -> int:
        return 4

    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self.encode_query(text) for text in texts]

    def encode_query(self, text: str) -> list[float]:
        return [float(len(text)), float(text.count("a")), float(text.count("e")), 1.0]


class StubSparse:
    def encode_documents(self, texts: Sequence[str]) -> list[SparseVector]:
        return [self.encode_query(text) for text in texts]

    def encode_query(self, text: str) -> SparseVector:
        indices = sorted({zlib.crc32(word.encode()) for word in text.lower().split()})
        return (indices, [1.0] * len(indices))


def make_chunk(
    index: int = 0, text: str = "Merge sort splits the array.", locale: Locale = "en"
) -> Chunk:
    return Chunk(
        chunk_id=f"{'ab' * 8}:classic:{index:04d}",
        chunk_index=index,
        text=text,
        embed_text=f"Algorithms\n{text}",
        locale=locale,
        course="PPM",
        source_file="deck.pdf",
        page=index + 1,
        pages=[index + 1],
        heading_path=["Algorithms"],
        parse_variant="classic",
        docling_version="0.0.0",
        source_sha256="ab" * 32,
    )


@pytest.fixture
def client(tmp_path: Path) -> Iterator[QdrantClient]:
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    yield qdrant
    qdrant.close()


def test_point_ids_are_deterministic_uuids() -> None:
    first = point_id_of("abcd:classic:0000")
    assert first == point_id_of("abcd:classic:0000")
    assert first != point_id_of("abcd:classic:0001")
    assert len(first) == 36


def test_indexing_is_idempotent_across_reruns(client: QdrantClient) -> None:
    """Re-indexing the same corpus snapshot must overwrite, not duplicate."""
    chunks = [make_chunk(0), make_chunk(1, "Quick sort picks a pivot.")]
    assert index_chunks(client, chunks, StubDense(), StubSparse()) == 2
    assert index_chunks(client, chunks, StubDense(), StubSparse()) == 2
    assert client.count(COLLECTION).count == 2


def test_payload_round_trips_the_full_chunk_contract(client: QdrantClient) -> None:
    chunk = make_chunk()
    index_chunks(client, [chunk], StubDense(), StubSparse())
    (point,) = client.retrieve(COLLECTION, ids=[point_id_of(chunk.chunk_id)], with_payload=True)
    assert Chunk.model_validate(point.payload) == chunk


def make_web_chunk(
    content_hash: str, source: str, url: str = "https://ingegneria.unifi.it/vp-185.html"
) -> Chunk:
    """A web chunk whose id changes with its content, as the real pipeline
    derives it — replacement must therefore come from the scoped delete, not
    from upsert overwriting."""
    return make_chunk().model_copy(
        update={
            "chunk_id": f"{content_hash[:16]}:html:0000",
            "kind": "web",
            "url": url,
            "ingest_source": source,
            "content_hash": content_hash,
            "parse_variant": "html",
        }
    )


def hashes_by_source(client: QdrantClient) -> dict[str, set[str]]:
    points, _ = client.scroll(COLLECTION, limit=100, with_payload=True)
    result: dict[str, set[str]] = {}
    for point in points:
        payload = point.payload or {}
        result.setdefault(str(payload["ingest_source"]), set()).add(str(payload["content_hash"]))
    return result


def test_web_reingest_leaves_no_stale_version_of_the_same_source(client: QdrantClient) -> None:
    """Same URL, same source, new content: the old version's hash must be gone
    (a count-based check would pass even while stale chunks survive)."""
    index_chunks(client, [make_web_chunk("aa" * 32, "crawl")], StubDense(), StubSparse())
    index_chunks(client, [make_web_chunk("bb" * 32, "crawl")], StubDense(), StubSparse())
    assert hashes_by_source(client) == {"crawl": {"bb" * 32}}


def test_live_ingest_never_touches_the_crawl_snapshot_version(client: QdrantClient) -> None:
    """Same URL ingested as crawl then as live: both versions coexist and the
    crawl hash is unchanged — the eval-isolation contract on the write path."""
    index_chunks(client, [make_web_chunk("aa" * 32, "crawl")], StubDense(), StubSparse())
    index_chunks(client, [make_web_chunk("cc" * 32, "live")], StubDense(), StubSparse())
    assert hashes_by_source(client) == {"crawl": {"aa" * 32}, "live": {"cc" * 32}}


def test_collect_chunk_files_scans_directories_and_passes_files_through(tmp_path: Path) -> None:
    first = tmp_path / "a.classic.jsonl"
    second = tmp_path / "b.classic.jsonl"
    first.touch()
    second.touch()
    (tmp_path / "not-chunks.json").touch()
    assert list(collect_chunk_files(tmp_path)) == [first, second]
    assert list(collect_chunk_files(first)) == [first]


def test_load_chunks_skips_blank_lines(tmp_path: Path) -> None:
    chunk = make_chunk()
    path = tmp_path / "deck.classic.jsonl"
    path.write_text(chunk.model_dump_json() + "\n\n", encoding="utf-8")
    assert load_chunks(path) == [chunk]


def test_cli_survives_a_bad_file_and_reports_the_tally(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """One corrupt JSONL must not lose the rest of the corpus run, but it must
    still fail the exit code so automation notices."""
    chunks_dir = tmp_path / "chunks"
    chunks_dir.mkdir()
    (chunks_dir / "deck.classic.jsonl").write_text(
        make_chunk().model_dump_json() + "\n", encoding="utf-8"
    )
    (chunks_dir / "bad.classic.jsonl").write_text("not json\n", encoding="utf-8")

    def stub_dense(model_name: str) -> DenseEncoder:
        return StubDense()

    def stub_sparse() -> SparseEncoder:
        return StubSparse()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    with pytest.raises(SystemExit):
        main([str(chunks_dir), "--qdrant-path", str(tmp_path / "qdrant")])
    assert "indexed 1/2" in capsys.readouterr().out


def test_importing_index_loads_none_of_the_heavy_dependencies() -> None:
    """Qdrant, fastembed and sentence-transformers (with torch behind it) must
    stay behind the builders: the contract and helpers are importable for free."""
    code = (
        "import rag.index, sys; "
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
