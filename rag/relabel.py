"""A one-off move of the slides points from the directory label to their
edition key, without re-embedding (#96).

The slides indexed before #96 carry the corpus directory's name as `course`
(`PPM`), no `academic_year`, and a `chunk_id` with no edition prefix. This
moves every such point to the edition key given by `--to`: the stored vectors
are copied as they are under the id of the new `chunk_id`, the parse sidecars
and chunk files are relabelled to match, and nothing is encoded again. The
module is deleted by the commit that records its run in docs/experiment-log.md.

    uv run python -m rag.relabel --from-course PPM --to B028451:2025-2026 --dry-run
    uv run python -m rag.relabel --from-course PPM --to B028451:2025-2026

A point id cannot change in place, so each point moves as an upsert of a new
point carrying the full payload, then a delete of the old id taken from the
list recorded at scan time, never recomputed. A rerun finishes a run that
stopped: the selection is `course == --from-course` alone, a new id written
twice is overwritten, and a file line relabelled once is left as it is.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import tracemalloc
from array import array
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, cast

from rag.chunk import DEFAULT_OUT_DIR as DEFAULT_CHUNKS_DIR
from rag.chunk import Chunk, EditionKey, chunk_id_of, edition_arg
from rag.index import (
    COLLECTION,
    DEFAULT_QDRANT_DIR,
    DENSE_VECTOR,
    SPARSE_VECTOR,
    WEB_COLLECTION,
    load_chunks,
    open_client,
    point_id_of,
)
from rag.parse import DEFAULT_OUT_DIR as DEFAULT_PARSED_DIR
from rag.parse import ParsedMeta
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from qdrant_client import QdrantClient
    from qdrant_client import models as qmodels

DEFAULT_LOG_DIR = DEFAULT_QDRANT_DIR.parent / "relabel-96"
BATCH = 256


@dataclass(frozen=True)
class Scanned:
    """One stored point as the scan read it: the vectors are the persisted raw
    values, since a freshly opened embedded client loads them unchanged."""

    point_id: str
    chunk: Chunk
    dense: list[float]
    sparse: qmodels.SparseVector


def elapsed(started: float) -> str:
    return f"{time.perf_counter() - started:.2f}s"


def course_is(course: str) -> qmodels.Filter:
    from qdrant_client import models

    return models.Filter(
        must=[models.FieldCondition(key="course", match=models.MatchValue(value=course))]
    )


def web_count(client: QdrantClient) -> int:
    if not client.collection_exists(WEB_COLLECTION):
        return 0
    return client.count(WEB_COLLECTION, exact=True).count


def vectors_of(point: qmodels.Record) -> tuple[list[float], qmodels.SparseVector]:
    from qdrant_client import models

    vectors = point.vector
    if not isinstance(vectors, dict):
        raise ValueError(f"{point.id}: no named vectors")
    dense, sparse = vectors.get(DENSE_VECTOR), vectors.get(SPARSE_VECTOR)
    if not isinstance(dense, list) or not isinstance(sparse, models.SparseVector):
        raise ValueError(f"{point.id}: missing the {DENSE_VECTOR} or {SPARSE_VECTOR} vector")
    return cast("list[float]", dense), sparse


def scan(client: QdrantClient, source: str) -> list[Scanned]:
    """Every point labelled `source`, with payload and vectors, to the end."""
    scanned: list[Scanned] = []
    offset = None
    while True:
        points, offset = client.scroll(
            COLLECTION,
            scroll_filter=course_is(source),
            limit=BATCH,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )
        for point in points:
            dense, sparse = vectors_of(point)
            chunk = Chunk.model_validate(point.payload or {})
            scanned.append(Scanned(str(point.id), chunk, dense, sparse))
        if offset is None:
            return scanned


def first_mismatch(scanned: list[Scanned]) -> str | None:
    """The first point whose `chunk_id` or id breaks the pre-#96 rule. A check
    only: the delete takes the ids the scan recorded, never ids recomputed
    from this rule."""
    for item in scanned:
        chunk = item.chunk
        old = chunk_id_of(None, chunk.source_sha256, chunk.parse_variant, chunk.chunk_index)
        if chunk.chunk_id != old or item.point_id != point_id_of(chunk.chunk_id):
            return item.point_id
    return None


def moved(chunk: Chunk, to: EditionKey) -> Chunk:
    return chunk.model_copy(
        update={
            "course": to.course,
            "academic_year": to.academic_year,
            "chunk_id": chunk_id_of(
                to, chunk.source_sha256, chunk.parse_variant, chunk.chunk_index
            ),
        }
    )


def sidecar_rewrites(parsed_dir: Path, source: str, to: EditionKey) -> dict[Path, str]:
    """The sidecars labelled `source`, each with its relabelled text, written
    the way `rag.parse` writes it."""
    rewrites: dict[Path, str] = {}
    for path in sorted(parsed_dir.glob("*.meta.json")):
        meta = ParsedMeta.model_validate_json(path.read_text(encoding="utf-8"))
        if meta.course == source:
            update = {"course": to.course, "academic_year": to.academic_year}
            rewrites[path] = meta.model_copy(update=update).model_dump_json(indent=2)
    return rewrites


def chunk_file_rewrites(
    chunks_dir: Path, source: str, to: EditionKey
) -> dict[Path, tuple[str, int]]:
    """The chunk files holding a line labelled `source`, each with its new
    text and how many lines move; every other line is kept byte for byte."""
    rewrites: dict[Path, tuple[str, int]] = {}
    for path in sorted(chunks_dir.glob("*.jsonl")):
        kept: list[str] = []
        count = 0
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            chunk = Chunk.model_validate_json(line)
            if chunk.course == source:
                kept.append(moved(chunk, to).model_dump_json())
                count += 1
            else:
                kept.append(line)
        if count:
            rewrites[path] = ("".join(line + "\n" for line in kept), count)
    return rewrites


def write_atomically(path: Path, text: str) -> None:
    """UTF-8 with LF, through a temporary file in the same directory."""
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(text.encode("utf-8"))
    os.replace(temporary, path)


def scan_phase(client: QdrantClient, source: str) -> list[Scanned]:
    """Phases 2 and 3: the scan, and the check that every id is the one the
    pre-#96 rule gives; a mismatch stops the run before anything is written."""
    started = time.perf_counter()
    scanned = scan(client, source)
    sources = len({item.chunk.source_file for item in scanned})
    print(f"scan: scanned {len(scanned)} points ({sources} source files) ({elapsed(started)})")

    started = time.perf_counter()
    mismatch = first_mismatch(scanned)
    if mismatch is not None:
        raise SystemExit(f"consistency: point {mismatch} breaks the pre-#96 id rule")
    print(f"consistency: {len(scanned)} ids follow the pre-#96 rule ({elapsed(started)})")
    return scanned


def dry_run(
    scanned: list[Scanned], parsed_dir: Path, chunks_dir: Path, source: str, to: EditionKey
) -> None:
    sidecars = sidecar_rewrites(parsed_dir, source, to)
    chunk_files = chunk_file_rewrites(chunks_dir, source, to)
    lines = sum(count for _, count in chunk_files.values())
    print(
        f"would move {len(scanned)} points; would rewrite {len(sidecars)} sidecars "
        f"and {len(chunk_files)} chunk files ({lines} lines)"
    )


def record_and_upsert(
    client: QdrantClient, scanned: list[Scanned], to: EditionKey, log_dir: Path
) -> dict[str, str]:
    """Phases 5 and 6: the {old id: new id} map on disk before any write, then
    the new points with the scanned raw vectors and the full payload (an
    upsert replaces a point's payload whole, so none is left to a default)."""
    from qdrant_client import models

    started = time.perf_counter()
    chunks = [moved(item.chunk, to) for item in scanned]
    mapping = {
        item.point_id: point_id_of(chunk.chunk_id)
        for item, chunk in zip(scanned, chunks, strict=True)
    }
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"ids-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json"
    path.write_bytes((json.dumps(mapping, indent=2) + "\n").encode("utf-8"))
    print(f"record: {len(mapping)} id pairs -> {path} ({elapsed(started)})")

    started = time.perf_counter()
    points = [
        models.PointStruct(
            id=mapping[item.point_id],
            vector={DENSE_VECTOR: item.dense, SPARSE_VECTOR: item.sparse},
            payload=chunk.model_dump(),
        )
        for item, chunk in zip(scanned, chunks, strict=True)
    ]
    for start in range(0, len(points), BATCH):
        client.upsert(COLLECTION, points[start : start + BATCH], wait=True)
    print(f"upsert: {len(points)} points in batches of {BATCH} ({elapsed(started)})")
    return mapping


def identical(stored: qmodels.Record, item: Scanned) -> bool:
    """Dense bit for bit, sparse as an index -> value map (the store may sort it)."""
    dense, sparse = vectors_of(stored)
    return array("d", dense).tobytes() == array("d", item.dense).tobytes() and dict(
        zip(sparse.indices, sparse.values, strict=True)
    ) == dict(zip(item.sparse.indices, item.sparse.values, strict=True))


def verify_then_delete(
    client: QdrantClient, scanned: list[Scanned], mapping: dict[str, str]
) -> None:
    """Phases 7 and 8 on a freshly opened client: an embedded client normalises
    a cosine vector in memory on upsert, and only the persisted state keeps the
    raw values. Unequal vectors undo the upsert and stop the run; equal ones
    let the old ids go, exactly those the scan recorded."""
    from qdrant_client import models

    started = time.perf_counter()
    stored = {
        str(point.id): point
        for point in client.retrieve(COLLECTION, ids=list(mapping.values()), with_vectors=True)
    }
    same = sum(
        1
        for item in scanned
        if (point := stored.get(mapping[item.point_id])) is not None and identical(point, item)
    )
    print(f"verify: vectors identical: {same}/{len(scanned)} ({elapsed(started)})")
    if same != len(scanned):
        new_ids: list[models.ExtendedPointId] = list(mapping.values())
        client.delete(COLLECTION, points_selector=models.PointIdsList(points=new_ids), wait=True)
        raise SystemExit(f"vectors differ: deleted the {len(new_ids)} new points, kept the old")

    started = time.perf_counter()
    old_ids: list[models.ExtendedPointId] = list(mapping)
    client.delete(COLLECTION, points_selector=models.PointIdsList(points=old_ids), wait=True)
    print(f"delete: {len(old_ids)} old points ({elapsed(started)})")


def rewrite_files(parsed_dir: Path, chunks_dir: Path, source: str, to: EditionKey) -> None:
    """Phase 9, on every run: a line or sidecar relabelled once no longer matches."""
    started = time.perf_counter()
    sidecars = sidecar_rewrites(parsed_dir, source, to)
    chunk_files = chunk_file_rewrites(chunks_dir, source, to)
    for path, text in sidecars.items():
        write_atomically(path, text)
    for path, (text, _) in chunk_files.items():
        write_atomically(path, text)
    lines = sum(count for _, count in chunk_files.values())
    print(
        f"files: rewrote {len(sidecars)} sidecars and {len(chunk_files)} chunk files "
        f"({lines} lines) ({elapsed(started)})"
    )


def check_final(client: QdrantClient, chunks_dir: Path, source: str, web_at_open: int) -> None:
    """Phase 10: the end state, the same whether the run started clean or
    resumed, so no count from before the run takes part."""
    started = time.perf_counter()
    file_ids = {
        point_id_of(chunk.chunk_id)
        for path in sorted(chunks_dir.glob("*.jsonl"))
        for chunk in load_chunks(path)
    }
    point_ids: set[str] = set()
    offset = None
    while True:
        points, offset = client.scroll(COLLECTION, limit=BATCH, offset=offset)
        point_ids.update(str(point.id) for point in points)
        if offset is None:
            break
    count = client.count(COLLECTION, exact=True).count
    left = client.count(COLLECTION, count_filter=course_is(source), exact=True).count
    web = web_count(client)
    same = point_ids == file_ids
    holds = count == len(file_ids) and same and left == 0 and web == web_at_open
    print(
        f"final: {count} {COLLECTION} points, {len(file_ids)} chunk ids in the files, "
        f"id sets {'equal' if same else 'DIFFERENT'}, {left} points with course {source}, "
        f"{WEB_COLLECTION} {web} points (open: {web_at_open}): "
        f"invariants {'hold' if holds else 'FAIL'} ({elapsed(started)})"
    )
    if not holds:
        raise SystemExit(1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-course", required=True, help="the directory label to move from")
    parser.add_argument("--to", required=True, type=edition_arg, help="CODE:YEAR")
    parser.add_argument("--dry-run", action="store_true", help="count, write nothing")
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--parsed-dir", type=Path, default=DEFAULT_PARSED_DIR)
    parser.add_argument("--chunks-dir", type=Path, default=DEFAULT_CHUNKS_DIR)
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    args = parser.parse_args(argv)
    source: str = args.from_course
    to: EditionKey = args.to

    configure_cli_logging()

    # The embedded client loads every collection into memory on open,
    # `unifi_web` included: the peak is part of the run's record.
    started = time.perf_counter()
    tracemalloc.start()
    client = open_client(args.qdrant_path)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    try:
        web_at_open = web_count(client)
        print(
            f"open: {WEB_COLLECTION} {web_at_open} points, tracemalloc peak "
            f"{peak / 2**20:.1f} MiB ({elapsed(started)})"
        )
        scanned = scan_phase(client, source)
        if args.dry_run:
            dry_run(scanned, args.parsed_dir, args.chunks_dir, source, to)
            return
        if scanned:
            mapping = record_and_upsert(client, scanned, to, args.log_dir)
            started = time.perf_counter()
            client.close()
            client = open_client(args.qdrant_path)
            print(f"reopen: {elapsed(started)}")
            verify_then_delete(client, scanned, mapping)
        rewrite_files(args.parsed_dir, args.chunks_dir, source, to)
        check_final(client, args.chunks_dir, source, web_at_open)
    finally:
        client.close()


if __name__ == "__main__":
    main()
