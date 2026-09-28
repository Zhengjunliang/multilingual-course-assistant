"""The one-off relabel of #96 (rag/relabel.py): every slides point moves to its
edition key with its stored vectors untouched, and a run that stopped before
deleting is finished by running it again. Deleted with the module once its run
is recorded in docs/experiment-log.md.

Every assertion on stored state reads through a freshly opened client: an
embedded client normalises a cosine vector in memory on upsert, so only the
persisted state shows whether the raw vectors survived the move."""

import json
from pathlib import Path
from typing import Any

import pytest
from qdrant_client import models
from test_index import StubDense, StubSparse, make_chunk, make_web_chunk

from rag.chunk import Chunk, chunk_id_of, edition_of
from rag.index import (
    COLLECTION,
    DENSE_VECTOR,
    SPARSE_VECTOR,
    WEB_COLLECTION,
    ensure_collection,
    load_chunks,
    open_client,
    point_id_of,
)
from rag.parse import ParsedMeta
from rag.relabel import main

TO = edition_of("B028451", "2025-2026")
WEB = make_web_chunk("ee" * 32, "crawl")


def old_chunk(source_file: str, sha: str, index: int, text: str) -> Chunk:
    """A slides chunk as the index held it before #96: the directory's name as
    `course`, no edition, and no edition prefix on `chunk_id`."""
    return make_chunk(index, text).model_copy(
        update={
            "chunk_id": chunk_id_of(None, sha, "classic", index),
            "course": "PPM",
            "academic_year": None,
            "source_file": source_file,
            "source_sha256": sha,
        }
    )


OLD = (
    old_chunk("a.pdf", "aa" * 32, 0, "Merge sort splits the array."),
    old_chunk("a.pdf", "aa" * 32, 1, "Quick sort picks a pivot."),
    old_chunk("b.pdf", "bb" * 32, 0, "An ORM maps tables to classes."),
)
NEW = tuple(
    chunk.model_copy(
        update={
            "course": TO.course,
            "academic_year": TO.academic_year,
            "chunk_id": chunk_id_of(TO, chunk.source_sha256, "classic", chunk.chunk_index),
        }
    )
    for chunk in OLD
)
NEW_IDS = {point_id_of(chunk.chunk_id) for chunk in NEW}


def old_payload(chunk: Chunk) -> dict[str, Any]:
    """The real pre-#96 payloads, like the chunk lines, lack both keys."""
    return chunk.model_dump(exclude={"kind", "academic_year"})


def point_of(chunk: Chunk, payload: dict[str, Any]) -> models.PointStruct:
    """The stub dense vector's norm is far from 1, so a normalised copy shows."""
    indices, values = StubSparse().encode_query(chunk.text)
    return models.PointStruct(
        id=point_id_of(chunk.chunk_id),
        vector={
            DENSE_VECTOR: StubDense().encode_query(chunk.embed_text),
            SPARSE_VECTOR: models.SparseVector(indices=indices, values=values),
        },
        payload=payload,
    )


def seed(tmp_path: Path, slides: list[models.PointStruct]) -> Path:
    """The index, the sidecars and the chunk files as they stand before the move."""
    qdrant = tmp_path / "qdrant"
    client = open_client(qdrant)
    for collection in (COLLECTION, WEB_COLLECTION):
        ensure_collection(client, StubDense().dimension(), collection)
    client.upsert(COLLECTION, slides)
    client.upsert(WEB_COLLECTION, [point_of(WEB, WEB.model_dump())])
    client.close()

    for directory in ("parsed", "chunks"):
        (tmp_path / directory).mkdir()
    for source_file, sha in (("a.pdf", "aa" * 32), ("b.pdf", "bb" * 32)):
        stem = source_file.removesuffix(".pdf")
        meta = ParsedMeta(
            source_file=source_file,
            source_path=f"data/corpus/PPM/{source_file}",
            source_sha256=sha,
            parse_variant="classic",
            docling_version="0.0.0",
            course="PPM",
            seconds=1.0,
            parsed_at="2026-01-01T00:00:00+00:00",
        )
        (tmp_path / "parsed" / f"{stem}.classic.meta.json").write_text(
            meta.model_dump_json(indent=2, exclude={"academic_year"}), encoding="utf-8"
        )
        lines = [
            chunk.model_dump_json(exclude={"kind", "academic_year"}) + "\n"
            for chunk in OLD
            if chunk.source_file == source_file
        ]
        (tmp_path / "chunks" / f"{stem}.classic.jsonl").write_text("".join(lines), encoding="utf-8")
    return qdrant


def cli(tmp_path: Path) -> list[str]:
    return [
        "--from-course",
        "PPM",
        "--to",
        "B028451:2025-2026",
        "--qdrant-path",
        str(tmp_path / "qdrant"),
        "--parsed-dir",
        str(tmp_path / "parsed"),
        "--chunks-dir",
        str(tmp_path / "chunks"),
        "--log-dir",
        str(tmp_path / "log"),
    ]


def stored(qdrant: Path, collection: str = COLLECTION) -> dict[str, models.Record]:
    client = open_client(qdrant)
    points, _ = client.scroll(collection, limit=100, with_payload=True, with_vectors=True)
    client.close()
    return {str(point.id): point for point in points}


def files(tmp_path: Path) -> dict[str, bytes]:
    return {
        path.name: path.read_bytes()
        for directory in ("parsed", "chunks")
        for path in sorted((tmp_path / directory).iterdir())
    }


def file_ids(tmp_path: Path) -> list[str]:
    return [
        point_id_of(chunk.chunk_id)
        for path in sorted((tmp_path / "chunks").glob("*.jsonl"))
        for chunk in load_chunks(path)
    ]


def test_relabel_moves_every_point_without_touching_vectors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The dry run writes nothing; the run moves each point under its new id
    with the persisted vectors bit for bit, leaves the web collection alone,
    relabels the files to match; and a second run finds nothing to do."""
    qdrant = seed(tmp_path, [point_of(chunk, old_payload(chunk)) for chunk in OLD])
    before, web, on_disk = stored(qdrant), stored(qdrant, WEB_COLLECTION), files(tmp_path)

    main([*cli(tmp_path), "--dry-run"])
    assert (
        "would move 3 points; would rewrite 2 sidecars and 2 chunk files (3 lines)"
        in capsys.readouterr().out
    )
    assert stored(qdrant) == before
    assert files(tmp_path) == on_disk
    assert not (tmp_path / "log").exists()

    main(cli(tmp_path))
    assert "vectors identical: 3/3" in capsys.readouterr().out

    after = stored(qdrant)
    assert set(after) == NEW_IDS
    for old, new in zip(OLD, NEW, strict=True):
        point = after[point_id_of(new.chunk_id)]
        assert Chunk.model_validate(point.payload) == new
        assert point.vector == point_of(old, {}).vector
    assert stored(qdrant, WEB_COLLECTION) == web

    metas = [
        ParsedMeta.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted((tmp_path / "parsed").glob("*.meta.json"))
    ]
    assert {(meta.course, meta.academic_year) for meta in metas} == {TO}
    assert sorted(file_ids(tmp_path)) == sorted(NEW_IDS)
    (mapping,) = (tmp_path / "log").glob("ids-*.json")
    assert json.loads(mapping.read_text(encoding="utf-8")) == {
        point_id_of(old.chunk_id): point_id_of(new.chunk_id)
        for old, new in zip(OLD, NEW, strict=True)
    }

    relabelled, on_disk = stored(qdrant), files(tmp_path)
    main(cli(tmp_path))
    assert stored(qdrant) == relabelled
    assert files(tmp_path) == on_disk


def test_relabel_finishes_a_run_that_stopped_before_deleting(tmp_path: Path) -> None:
    """A run that stopped between the upsert and the delete leaves every point
    twice, under its old id and its new one: running again leaves each once,
    under the new id, matching the chunk files."""
    qdrant = seed(
        tmp_path,
        [point_of(chunk, old_payload(chunk)) for chunk in OLD]
        + [point_of(chunk, chunk.model_dump()) for chunk in NEW],
    )
    assert len(stored(qdrant)) == 6

    main(cli(tmp_path))

    after = stored(qdrant)
    assert set(after) == NEW_IDS
    assert sorted(file_ids(tmp_path)) == sorted(after)
    assert {str((point.payload or {})["course"]) for point in after.values()} == {TO.course}
