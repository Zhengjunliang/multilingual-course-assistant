"""Snapshots of the index: a copy of its collections on the host, and that copy
restored on a server that does not hold them.

A run asks the Qdrant server for a snapshot of each collection, streams it into
a new directory under data/snapshots/ named for the UTC time the run started,
and deletes the server's copy: the server writes snapshots under its
snapshots_path, which the compose image keeps outside the mounted volume, so a
copy left there would vanish with the container. Beside the files,
manifest.json records the server's version and each collection's points per
(url, ingest_source) pair, counted just before its snapshot.

--restore uploads such a directory to the server --qdrant names, then prints
the restored counts beside the manifest's and fails when they differ. That
server must not hold the collections already: an upload replaces a collection
the server holds, and the default server is the one whose pages fetched live
exist nowhere else.

    uv run python -m rag.snapshot
    uv run python -m rag.snapshot --restore data/snapshots/<time> --qdrant http://127.0.0.1:6340
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from rag.index import (
    COLLECTION,
    SERVER_SCHEMES,
    WEB_COLLECTION,
    add_qdrant_argument,
    open_client,
)
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    import httpx
    from qdrant_client import QdrantClient

logger = logging.getLogger(__name__)

COLLECTIONS = (COLLECTION, WEB_COLLECTION)
DEFAULT_OUT = Path("data/snapshots")
MANIFEST = "manifest.json"
# Differing pairs printed per collection; the summary line gives how many there are.
SHOWN_DIFFERENCES = 10

_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")

VersionKey = tuple[str | None, str | None]


class Entry(TypedDict):
    file: str
    size: int
    sha256: str
    points: int
    # (url, ingest_source, points) rows: JSON has no object keyed by a pair.
    versions: list[tuple[str | None, str | None, int]]


class Manifest(TypedDict):
    qdrant_version: str
    taken_at: str
    collections: dict[str, Entry]


def web_version_counts(client: QdrantClient, collection: str) -> dict[VersionKey, int]:
    """Points per (url, ingest_source) pair over the whole collection: the measure
    `rag.index.count_web_versions` takes of one pair. A slides point carries
    neither field, so `slides` is a single (None, None) group."""
    counts: dict[VersionKey, int] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            collection,
            limit=1000,
            offset=offset,
            with_payload=["url", "ingest_source"],
            with_vectors=False,
        )
        for point in points:
            payload = point.payload or {}
            key = (payload.get("url"), payload.get("ingest_source"))
            counts[key] = counts.get(key, 0) + 1
        if offset is None:
            return counts


def restorable(source: str, target: str) -> bool:
    """Qdrant restores a snapshot on a server of the same minor version, at the
    same patch or a later one, or of the next minor version (outside the
    repository: Qdrant's Snapshots documentation)."""
    was, now = _version_of(source), _version_of(target)
    return now >= was and now[0] == was[0] and now[1] <= was[1] + 1


def _version_of(text: str) -> tuple[int, int, int]:
    match = _VERSION.match(text)
    if match is None:
        raise ValueError(f"not a Qdrant version: {text!r}")
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def _by_pair(pair: VersionKey) -> tuple[str, str]:
    return (pair[0] or "", pair[1] or "")


def _result(reply: httpx.Response) -> Any:
    reply.raise_for_status()
    return reply.json()["result"]


def server_version(http: httpx.Client) -> str:
    reply = http.get("/")
    reply.raise_for_status()
    return str(reply.json()["version"])


def _download(
    http: httpx.Client, collection: str, snapshot: str, checksum: str | None, target: Path
) -> str:
    """Stream one snapshot to `target` and return its sha256. A file that does not
    match the checksum the server computed is removed, never left in place
    looking complete."""
    part = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    with http.stream("GET", f"/collections/{collection}/snapshots/{snapshot}") as reply:
        reply.raise_for_status()
        with part.open("wb") as file:
            for block in reply.iter_bytes():
                file.write(block)
                digest.update(block)
    sha256 = digest.hexdigest()
    if checksum is not None and checksum != sha256:
        part.unlink()
        raise RuntimeError(f"{collection}: downloaded sha256 {sha256}, the server's is {checksum}")
    part.replace(target)
    return sha256


def take(http: httpx.Client, client: QdrantClient, out: Path) -> Path:
    """Snapshot every collection into a new directory under `out` and return it.
    manifest.json is written last: a directory without one is a run that failed,
    and `restore` refuses it."""
    started = datetime.now(UTC)
    directory = out / started.strftime("%Y%m%d-%H%M%S")
    directory.mkdir(parents=True)
    manifest: Manifest = {
        "qdrant_version": server_version(http),
        "taken_at": started.isoformat(timespec="seconds"),
        "collections": {},
    }
    for collection in COLLECTIONS:
        # Counted first: a page fetched live before the snapshot is taken makes the
        # restore compare unequal, which is the safe direction to be wrong in.
        counts = web_version_counts(client, collection)
        snapshot = _result(http.post(f"/collections/{collection}/snapshots"))
        name = str(snapshot["name"])
        try:
            sha256 = _download(http, collection, name, snapshot.get("checksum"), directory / name)
        finally:
            # On failure too: the server's copy is as large as the file.
            _result(http.delete(f"/collections/{collection}/snapshots/{name}"))
        size = (directory / name).stat().st_size
        manifest["collections"][collection] = {
            "file": name,
            "size": size,
            "sha256": sha256,
            "points": sum(counts.values()),
            "versions": [(*pair, counts[pair]) for pair in sorted(counts, key=_by_pair)],
        }
        logger.info("%s: %d points, %s (%d bytes)", collection, sum(counts.values()), name, size)
    (directory / MANIFEST).write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return directory


def restore(http: httpx.Client, client: QdrantClient, directory: Path) -> bool:
    """Upload the snapshots of `directory` to a server that holds none of their
    collections, print each collection's counts as source / restored, and return
    whether every count is equal."""
    manifest: Manifest = json.loads((directory / MANIFEST).read_text(encoding="utf-8"))
    version = server_version(http)
    if not restorable(manifest["qdrant_version"], version):
        raise SystemExit(
            f"snapshots of Qdrant {manifest['qdrant_version']} do not restore on {version}: "
            "the server must run the same minor version or the next one"
        )
    held = [name for name in manifest["collections"] if client.collection_exists(name)]
    if held:
        raise SystemExit(
            f"the server holds {', '.join(held)} already, and an upload would replace it"
        )

    for collection, entry in manifest["collections"].items():
        with (directory / entry["file"]).open("rb") as file:
            _result(
                http.post(
                    f"/collections/{collection}/snapshots/upload",
                    # The server checks the file against the sha256 the download had.
                    params={"priority": "snapshot", "checksum": entry["sha256"]},
                    files={"snapshot": (entry["file"], file)},
                )
            )
        logger.info("%s: %s restored", collection, entry["file"])

    equal = True
    for collection, entry in manifest["collections"].items():
        expected = {(url, source): count for url, source, count in entry["versions"]}
        restored = web_version_counts(client, collection)
        differ = sorted(
            (
                pair
                for pair in expected.keys() | restored.keys()
                if expected.get(pair) != restored.get(pair)
            ),
            key=_by_pair,
        )
        print(
            f"{collection}: points {entry['points']} / {sum(restored.values())}, "
            f"(url, ingest_source) pairs {len(expected)} / {len(restored)}, {len(differ)} differ"
        )
        for pair in differ[:SHOWN_DIFFERENCES]:
            url, source = pair
            print(f"  {url} [{source}]: {expected.get(pair, 0)} / {restored.get(pair, 0)}")
        equal = equal and not differ
    return equal


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_qdrant_argument(parser)
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="where a run creates its directory (default: %(default)s)",
    )
    parser.add_argument(
        "--restore",
        type=Path,
        metavar="DIR",
        help="a directory a run wrote: upload it to --qdrant, which must hold none of its "
        "collections, and compare the counts",
    )
    args = parser.parse_args(argv)
    if args.qdrant is not None and not args.qdrant.startswith(SERVER_SCHEMES):
        parser.error("snapshots are a Qdrant server's: pass its http(s) URL, not a directory")

    configure_cli_logging()

    import httpx

    from config.env import env

    url: str = args.qdrant or env.qdrant_url
    client = open_client(url)
    # Writing and streaming the web collection's snapshot takes a while: a
    # deadline on connecting, none on reading.
    with httpx.Client(base_url=url, timeout=httpx.Timeout(30.0, read=None)) as http:
        if args.restore is not None:
            equal = restore(http, client, args.restore)
        else:
            directory = take(http, client, args.out)
            for path in sorted(directory.iterdir()):
                print(f"{path}  {path.stat().st_size} bytes")
            equal = True
    client.close()
    if not equal:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
