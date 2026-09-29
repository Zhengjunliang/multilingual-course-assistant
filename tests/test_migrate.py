"""The one-off move of #33 (rag/migrate.py): both collections reach the target
whole, the preflight never lets a rerun delete a point only the target holds,
and the checks name what differs. Deleted with the module once its run is
recorded in docs/experiment-log.md.

A second embedded index stands in for the server: `open_client` opens a
directory given to `--to`. What only a server has — the telemetry, the
optimizer settings a server applies — is covered by the parser cases below and
by the real run."""

from pathlib import Path
from typing import Any

import pytest
from qdrant_client import models
from test_gold import make_campus_question, make_question
from test_index import StubDense, StubSparse, make_chunk, make_web_chunk

from rag.index import (
    COLLECTION,
    DENSE_VECTOR,
    SPARSE_VECTOR,
    WEB_COLLECTION,
    ensure_collection,
    index_chunks,
    open_client,
    point_id_of,
)
from rag.migrate import config_differences, dense_index_from_telemetry, main

# Local mode answers `exact=True` with this warning (its search is always
# exact), and the recall check asks for exact search on purpose.
pytestmark = pytest.mark.filterwarnings("ignore:Local mode performs exact:UserWarning")

SLIDES = [make_chunk(0, "Merge sort splits the array."), make_chunk(1, "Quick sort picks a pivot.")]
CRAWL = make_web_chunk("aa" * 32, "crawl")
LIVE = make_web_chunk("bb" * 32, "live", url="https://www.unifi.it/it/tasse")


@pytest.fixture
def stubbed(monkeypatch: pytest.MonkeyPatch) -> None:
    """No model to load, and a plain dense index: local mode has no telemetry."""
    monkeypatch.setattr("rag.migrate.build_dense_encoder", lambda *_, **__: StubDense())
    monkeypatch.setattr("rag.migrate.dense_index_state", lambda *_: (0, 1, 0))


def make_source(tmp_path: Path) -> tuple[Path, Path, Path]:
    """An embedded source with both collections and a live page, an empty
    target directory, and a gold file with one question per collection."""
    source, target, gold = tmp_path / "source", tmp_path / "target", tmp_path / "gold.jsonl"
    client = open_client(source)
    ensure_collection(client, StubDense().dimension())
    index_chunks(client, SLIDES, StubDense(), StubSparse())
    ensure_collection(client, StubDense().dimension(), WEB_COLLECTION)
    index_chunks(client, [CRAWL, LIVE], StubDense(), StubSparse(), WEB_COLLECTION)
    client.close()
    gold.write_text(
        make_question().model_dump_json() + "\n" + make_campus_question().model_dump_json() + "\n",
        encoding="utf-8",
    )
    return source, target, gold


def run(source: Path, target: Path, gold: Path, *flags: str) -> None:
    main(["--from", str(source), "--to", str(target), "--gold", str(gold), *flags])


@pytest.mark.usefixtures("stubbed")
def test_migration_copies_both_collections_and_refuses_to_lose_points(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source, target, gold = make_source(tmp_path)

    run(source, target, gold, "--dry-run")
    assert "source: slides 2 | unifi_web 2 (1 live points over 1 urls)" in capsys.readouterr().out
    client = open_client(target)
    assert client.get_collections().collections == []
    client.close()

    run(source, target, gold)
    out = capsys.readouterr().out
    for line in (
        "counts: unifi_web 2 = 2",
        "versions: 3 (url, ingest_source) pairs equal",
        "points identical: slides 2/2",
        "points identical: unifi_web 2/2",
        "gate: exact by construction",
        "result: PASS",
    ):
        assert line in out

    with pytest.raises(SystemExit) as refused:
        run(source, target, gold)
    assert refused.value.code == 1
    assert "REFUSE target has slides, unifi_web; pass --replace" in capsys.readouterr().out

    # A page fetched live into the target after the move: recreating the
    # collection from the source would delete it.
    only_there = make_web_chunk("cc" * 32, "live", url="https://www.unifi.it/it/nuova")
    client = open_client(target)
    index_chunks(client, [only_there], StubDense(), StubSparse(), WEB_COLLECTION)
    client.close()
    with pytest.raises(SystemExit):
        run(source, target, gold, "--replace")
    assert "REFUSE --replace would delete 1 points" in capsys.readouterr().out

    client = open_client(target)
    client.delete(
        WEB_COLLECTION,
        points_selector=models.PointIdsList(points=[point_id_of(only_there.chunk_id)]),
    )
    client.close()
    run(source, target, gold, "--replace")
    assert "result: PASS" in capsys.readouterr().out


def change_payload(client: Any, point: str) -> None:
    client.set_payload(COLLECTION, {"page": 99}, points=[point])


def turn_dense(client: Any, point: str) -> None:
    (stored,) = client.retrieve(COLLECTION, ids=[point], with_payload=True, with_vectors=True)
    vectors = dict(stored.vector)
    vectors[DENSE_VECTOR] = [0.0, 0.0, 1.0, 0.0]
    assert SPARSE_VECTOR in vectors
    client.upsert(
        COLLECTION, [models.PointStruct(id=point, vector=vectors, payload=stored.payload)]
    )


def drop(client: Any, point: str) -> None:
    client.delete(COLLECTION, points_selector=models.PointIdsList(points=[point]))


@pytest.mark.usefixtures("stubbed")
@pytest.mark.parametrize(
    ("kind", "damage"),
    [("payload", change_payload), ("dense", turn_dense), ("missing", drop)],
    ids=["payload", "dense", "missing"],
)
def test_verification_names_the_first_point_that_differs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str, damage: Any
) -> None:
    source, target, gold = make_source(tmp_path)
    run(source, target, gold)
    point = point_id_of(SLIDES[1].chunk_id)
    client = open_client(target)
    damage(client, point)
    client.close()
    capsys.readouterr()

    with pytest.raises(SystemExit):
        run(source, target, gold, "--verify-only")

    out = capsys.readouterr().out
    assert f"MISMATCH slides {point} {kind}" in out
    assert "points identical: slides 1/2" in out
    assert "result: FAIL" in out


def segment(index: str, indexed: int) -> dict[str, Any]:
    """One segment of GET /telemetry?details_level=4, trimmed from a 1.19.1
    server's reply: the sparse vector sits beside the dense one in both maps."""
    return {
        "info": {
            "num_points": indexed,
            "vector_data": {
                "sparse": {"num_vectors": indexed, "num_indexed_vectors": indexed},
                "dense": {"num_vectors": indexed, "num_indexed_vectors": indexed},
            },
        },
        "config": {
            "vector_data": {"dense": {"index": {"type": index, "options": {}}}},
            "sparse_vector_data": {"sparse": {"index": {"index_type": "ImmutableRam"}}},
        },
    }


TELEMETRY = {
    "collections": {
        "number_of_collections": 2,
        "collections": [
            {
                "id": "slides",
                "shards": [
                    {"id": 0, "local": {"segments": [segment("plain", 0), segment("plain", 154)]}}
                ],
            },
            {
                "id": "unifi_web",
                "shards": [
                    {"id": 0, "local": {"segments": [segment("plain", 0), segment("hnsw", 384)]}}
                ],
            },
        ],
    }
}


@pytest.mark.parametrize("case", ["telemetry-hnsw", "telemetry-plain", "config-differs"])
def test_the_parsers_read_the_server_answers(case: str, tmp_path: Path) -> None:
    if case == "telemetry-hnsw":
        assert dense_index_from_telemetry(TELEMETRY, WEB_COLLECTION) == (1, 2, 384)
    elif case == "telemetry-plain":
        assert dense_index_from_telemetry(TELEMETRY, COLLECTION) == (0, 2, 0)
    else:
        # What migrate() copies from local mode, against what a server gives a
        # collection that ensure_collection creates.
        client = open_client(tmp_path / "qdrant")
        ensure_collection(client, StubDense().dimension())
        migrated = client.get_collection(COLLECTION).config
        client.close()
        optimizer = migrated.optimizer_config.model_copy(
            update={"indexing_threshold": 10000, "max_optimization_threads": None}
        )
        probe = migrated.model_copy(update={"optimizer_config": optimizer})
        assert config_differences(migrated, probe) == [
            "optimizer_config.indexing_threshold",
            "optimizer_config.max_optimization_threads",
        ]
