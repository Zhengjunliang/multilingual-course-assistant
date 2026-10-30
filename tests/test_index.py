"""Indexing must be idempotent and payload-complete: whatever goes into Qdrant
is all that retrieval will ever have. All tests run offline — stub encoders and
an embedded Qdrant under tmp_path stand in for the real models and store."""

import argparse
import subprocess
import sys
import zlib
from collections.abc import Iterator, Sequence
from pathlib import Path
from types import SimpleNamespace

import pytest
import qdrant_client
from pydantic import SecretStr
from qdrant_client import QdrantClient

from config.env import env
from rag.chunk import Chunk, Locale, chunk_id_of, edition_of
from rag.index import (
    COLLECTION,
    DEFAULT_DENSE_MODEL,
    WEB_COLLECTION,
    DenseEncoder,
    SparseEncoder,
    SparseVector,
    add_qdrant_argument,
    build_dense_encoder,
    cached_dense_encoder,
    collect_chunk_files,
    delete_by_run,
    delete_material,
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
        chunk_id=f"B028451:2025-2026:{'ab' * 8}:classic:{index:04d}",
        chunk_index=index,
        text=text,
        embed_text=f"Algorithms\n{text}",
        locale=locale,
        course="B028451",
        academic_year="2025-2026",
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
    # This value must never change: re-indexing in a new process has to overwrite
    # the points an earlier process wrote, not duplicate them. A namespace change,
    # or a switch to the per-process salted hash(), would pass every test that
    # compares two ids computed in the same process.
    assert point_id_of("abcd:classic:0000") == "47bd6dc5-6b06-58ba-8be7-f555c43eea5f"


@pytest.mark.parametrize(
    "location",
    ["", "localhost:6333", "127.0.0.1:6333/", "grpc://localhost:6334"],
    ids=["empty", "host-port", "host-port-path", "other-scheme"],
)
def test_open_client_refuses_what_is_neither_a_url_nor_a_directory(
    location: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Opened as directories, these would create an embedded index somewhere
    # nobody meant, and the process would hold its lock instead of sharing the
    # server; the working directory is tmp_path so a regression writes there.
    # The URL branch has no test here: a remote client checks the server's
    # version on a thread of its own, which warns when CI has no server.
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match="not a Qdrant location"):
        open_client(location)
    # Every rag command refuses it while parsing, before a model loads.
    parser = argparse.ArgumentParser()
    add_qdrant_argument(parser)
    with pytest.raises(SystemExit):
        parser.parse_args(["--qdrant", location])
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("key", "sent"),
    [(SecretStr("k"), "k"), (SecretStr(""), None), (None, None)],
    ids=["set", "empty", "unset"],
)
def test_the_api_key_goes_to_a_server_and_never_to_an_embedded_index(
    key: SecretStr | None, sent: str | None, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A recorder in place of the client, since a real remote one checks the
    # server's version on a thread of its own (above).
    opened: list[dict[str, object]] = []
    monkeypatch.setattr(qdrant_client, "QdrantClient", lambda **kwargs: opened.append(kwargs))
    monkeypatch.setattr(env, "qdrant_api_key", key)
    open_client("http://127.0.0.1:6333")
    open_client(tmp_path / "qdrant")
    assert opened == [
        {"url": "http://127.0.0.1:6333", "api_key": sent},
        {"path": str(tmp_path / "qdrant")},
    ]


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


def make_deck(academic_year: str, sha: str, count: int) -> list[Chunk]:
    """`deck.pdf` as `rag.chunk` writes it for one edition and one content."""
    edition = edition_of("B028451", academic_year)
    return [
        make_chunk(index).model_copy(
            update={
                "chunk_id": chunk_id_of(edition, sha, "classic", index),
                "academic_year": academic_year,
                "source_sha256": sha,
            }
        )
        for index in range(count)
    ]


def test_slides_reindex_replaces_only_its_edition(client: QdrantClient) -> None:
    """One PDF taught in two editions, then re-indexed in one with new content:
    a delete keyed by the new sha finds nothing of the old content, and one
    without the year would take the other edition's points along."""
    old, new = "ab" * 32, "cd" * 32
    index_chunks(client, make_deck("2024-2025", old, 2), StubDense(), StubSparse())
    index_chunks(client, make_deck("2025-2026", old, 2), StubDense(), StubSparse())
    index_chunks(client, make_deck("2024-2025", new, 1), StubDense(), StubSparse())

    points, _ = client.scroll(COLLECTION, limit=100, with_payload=True)
    chunks = [Chunk.model_validate(point.payload) for point in points]
    assert {(chunk.academic_year, chunk.source_sha256, chunk.chunk_index) for chunk in chunks} == {
        ("2024-2025", new, 0),
        ("2025-2026", old, 0),
        ("2025-2026", old, 1),
    }


def test_deleting_a_material_takes_only_its_own_bytes_in_its_own_edition(
    client: QdrantClient,
) -> None:
    """What a failed ingest leaves is removed by its digest: the same PDF in
    another edition stays, and so does another file of the same edition."""
    old, other = "ab" * 32, "cd" * 32
    index_chunks(client, make_deck("2024-2025", old, 2), StubDense(), StubSparse())
    index_chunks(client, make_deck("2025-2026", old, 1), StubDense(), StubSparse())
    renamed = [
        chunk.model_copy(update={"source_file": "other.pdf"})
        for chunk in make_deck("2024-2025", other, 1)
    ]
    index_chunks(client, renamed, StubDense(), StubSparse())

    delete_material(client, old, edition_of("B028451", "2024-2025"))

    points, _ = client.scroll(COLLECTION, limit=100, with_payload=True)
    chunks = [Chunk.model_validate(point.payload) for point in points]
    assert {(chunk.academic_year, chunk.source_sha256) for chunk in chunks} == {
        ("2025-2026", old),
        ("2024-2025", other),
    }


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
            "course": "ingegneria",
            "academic_year": None,
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


@pytest.mark.parametrize(
    ("source", "kept"),
    [
        # Same source, new content: the old version's hash must be gone (a
        # count-based check would pass even while stale chunks survive).
        pytest.param("crawl", {"crawl": {"bb" * 32}}, id="same-source"),
        # Crawl then live: both versions coexist and the crawl hash is unchanged,
        # the eval-isolation rule (docs/architecture.md) on the write path.
        pytest.param("live", {"crawl": {"aa" * 32}, "live": {"bb" * 32}}, id="live-beside-crawl"),
    ],
)
def test_reingesting_a_page_replaces_only_its_own_source_version(
    client: QdrantClient, source: str, kept: dict[str, set[str]]
) -> None:
    index_chunks(client, [make_web_chunk("aa" * 32, "crawl")], StubDense(), StubSparse())
    index_chunks(client, [make_web_chunk("bb" * 32, source)], StubDense(), StubSparse())
    assert hashes_by_source(client) == kept


def make_run_chunk(content_hash: str, source: str, run_id: str, url: str) -> Chunk:
    return make_web_chunk(content_hash, source, url).model_copy(update={"ingest_run_id": run_id})


def test_rollback_deletes_one_run_and_leaves_the_others(client: QdrantClient) -> None:
    """Rolling back a live run must be surgical: another live run and the crawl
    snapshot both survive it."""
    ensure_collection(client, StubDense().dimension(), WEB_COLLECTION)
    index_chunks(
        client,
        [
            make_run_chunk("aa" * 32, "live", "live-a", "https://unifi.example.org/a"),
            make_run_chunk("bb" * 32, "live", "live-b", "https://unifi.example.org/b"),
            make_run_chunk("cc" * 32, "crawl", "crawl-1", "https://unifi.example.org/c"),
        ],
        StubDense(),
        StubSparse(),
        WEB_COLLECTION,
    )

    delete_by_run(client, "live-a", WEB_COLLECTION)

    points, _ = client.scroll(WEB_COLLECTION, limit=100, with_payload=True)
    assert {
        (str((point.payload or {})["ingest_source"]), str((point.payload or {})["ingest_run_id"]))
        for point in points
    } == {("live", "live-b"), ("crawl", "crawl-1")}


def test_rollback_with_a_crawl_run_id_deletes_nothing(client: QdrantClient) -> None:
    """The failure this guards against is unrecoverable: one mistyped run id on
    a single-condition predicate would erase a frozen M3 snapshot."""
    ensure_collection(client, StubDense().dimension(), WEB_COLLECTION)
    index_chunks(
        client,
        [make_run_chunk("cc" * 32, "crawl", "crawl-1", "https://unifi.example.org/c")],
        StubDense(),
        StubSparse(),
        WEB_COLLECTION,
    )

    delete_by_run(client, "crawl-1", WEB_COLLECTION)

    assert client.count(WEB_COLLECTION).count == 1


def fake_sentence_transformers(built: list[tuple[str, str | None]]) -> SimpleNamespace:
    """The real package drags torch in; the encoder contract under test is one
    constructor call."""

    class FakeModel:
        def __init__(self, model_name: str, device: str | None = None) -> None:
            built.append((model_name, device))

    return SimpleNamespace(SentenceTransformer=FakeModel)


def test_dense_encoder_hands_the_device_to_sentence_transformers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """None is sentence-transformers' own "you pick" — it has no "auto"
    sentinel, so the default call must stay a None, not a string."""
    built: list[tuple[str, str | None]] = []
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_sentence_transformers(built))

    build_dense_encoder(DEFAULT_DENSE_MODEL)
    build_dense_encoder(DEFAULT_DENSE_MODEL, device="cpu")

    assert built == [(DEFAULT_DENSE_MODEL, None), (DEFAULT_DENSE_MODEL, "cpu")]


def test_cached_dense_encoder_shares_one_instance_per_model_and_device(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The CPU encoder is shared between live ingest and the agent's candidate
    narrowing: a second instance would be another ~2.4GB and another load."""
    built: list[tuple[str, str | None]] = []
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_sentence_transformers(built))
    # A local model directory no other test, nor a rerun of this one, has put in
    # the process-wide cache — so the first call is a guaranteed miss.
    model = str(tmp_path)

    cpu = cached_dense_encoder(model, device="cpu")
    assert cached_dense_encoder(model, device="cpu") is cpu
    assert cached_dense_encoder(model) is not cpu  # a different device is a different instance
    assert built == [(model, "cpu"), (model, None)]


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


@pytest.fixture
def stub_encoders(monkeypatch: pytest.MonkeyPatch) -> None:
    """The CLI builds its own encoders; these stand in for the real models."""

    def stub_dense(model_name: str) -> DenseEncoder:
        return StubDense()

    def stub_sparse() -> SparseEncoder:
        return StubSparse()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)


def write_chunk_file(
    path: Path, source_file: str, sha: str, academic_year: str = "2025-2026"
) -> None:
    """One PDF's chunk file as `rag.chunk` writes it: a `Chunk` per JSONL line."""
    path.parent.mkdir(parents=True, exist_ok=True)
    chunks = [
        chunk.model_copy(update={"source_file": source_file})
        for chunk in make_deck(academic_year, sha, 1)
    ]
    path.write_text("".join(chunk.model_dump_json() + "\n" for chunk in chunks), encoding="utf-8")


def indexed_files(qdrant_path: Path) -> set[tuple[str, str]]:
    """(academic_year, source_file) of every point the CLI left behind."""
    stored = open_client(qdrant_path)
    points, _ = stored.scroll(COLLECTION, limit=100, with_payload=True)
    stored.close()
    return {
        (str((point.payload or {})["academic_year"]), str((point.payload or {})["source_file"]))
        for point in points
    }


@pytest.mark.parametrize("change", ["deleted", "renamed"])
@pytest.mark.usefixtures("stub_encoders")
def test_directory_index_drops_the_files_that_left_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], change: str
) -> None:
    """A deck deleted or renamed in the directory must stop answering, and the
    same deck in another edition, indexed from another directory, must not."""
    qdrant = tmp_path / "qdrant"
    older, current = tmp_path / "2024-2025", tmp_path / "2025-2026"
    write_chunk_file(older / "b.classic.jsonl", "b.pdf", "bb" * 32, "2024-2025")
    write_chunk_file(current / "a.classic.jsonl", "a.pdf", "aa" * 32)
    write_chunk_file(current / "b.classic.jsonl", "b.pdf", "bb" * 32)
    main([str(older), "--qdrant", str(qdrant)])
    main([str(current), "--qdrant", str(qdrant)])

    (current / "b.classic.jsonl").unlink()
    if change == "renamed":
        # Its own sha: with b's, c's points would take b's ids and overwrite them,
        # and b's one point would be gone without the sync dropping it.
        write_chunk_file(current / "c.classic.jsonl", "c.pdf", "cc" * 32)
    capsys.readouterr()
    main([str(current), "--qdrant", str(qdrant)])

    assert "dropped 1 points" in capsys.readouterr().out
    renamed = {("2025-2026", "c.pdf")} if change == "renamed" else set()
    assert indexed_files(qdrant) == {("2025-2026", "a.pdf"), ("2024-2025", "b.pdf"), *renamed}


@pytest.mark.usefixtures("stub_encoders")
def test_single_file_index_deletes_no_other_file(tmp_path: Path) -> None:
    """Updating one file is how a partial update is done: it must not read as
    a directory that lost every other file."""
    qdrant = tmp_path / "qdrant"
    write_chunk_file(tmp_path / "chunks" / "a.classic.jsonl", "a.pdf", "aa" * 32)
    write_chunk_file(tmp_path / "chunks" / "b.classic.jsonl", "b.pdf", "bb" * 32)
    main([str(tmp_path / "chunks"), "--qdrant", str(qdrant)])
    main([str(tmp_path / "chunks" / "a.classic.jsonl"), "--qdrant", str(qdrant)])
    assert indexed_files(qdrant) == {("2025-2026", "a.pdf"), ("2025-2026", "b.pdf")}


@pytest.mark.parametrize("failure", ["corrupt", "duplicate-source"])
@pytest.mark.usefixtures("stub_encoders")
def test_cli_survives_a_bad_file_and_reports_the_tally(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], failure: str
) -> None:
    """One bad file must not lose the rest of the corpus run, but it must still
    fail the exit code so automation notices, and skip the sync: the points of
    a file that failed would look gone. Two files of one source in one edition
    count as a failure, since the second would silently replace the first."""
    qdrant = tmp_path / "qdrant"
    write_chunk_file(tmp_path / "gone.classic.jsonl", "gone.pdf", "ee" * 32)
    main([str(tmp_path / "gone.classic.jsonl"), "--qdrant", str(qdrant)])
    chunks_dir = tmp_path / "chunks"
    write_chunk_file(chunks_dir / "deck.classic.jsonl", "deck.pdf", "aa" * 32)
    if failure == "corrupt":
        (chunks_dir / "bad.classic.jsonl").write_text("not json\n", encoding="utf-8")
    else:
        write_chunk_file(chunks_dir / "deck-copy.classic.jsonl", "deck.pdf", "aa" * 32)

    capsys.readouterr()
    with pytest.raises(SystemExit):
        main([str(chunks_dir), "--qdrant", str(qdrant)])
    assert "indexed 1/2" in capsys.readouterr().out
    assert ("2025-2026", "gone.pdf") in indexed_files(qdrant)


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
