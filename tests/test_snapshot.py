"""A snapshot set must hold every collection and the counts to check a restore
against, and a restore must never land on a server holding the collections.
All tests run offline: httpx's MockTransport answers for the Qdrant server's
snapshot endpoints, and embedded Qdrant indexes under tmp_path stand for what
it holds."""

import hashlib
import json
import re
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from qdrant_client import QdrantClient, models

from config.env import env
from rag.index import COLLECTION, WEB_COLLECTION, open_client
from rag.snapshot import MANIFEST, main, restorable, restore, server_http, take

SLIDES: list[dict[str, Any]] = [{"source_file": "deck.pdf"}, {"source_file": "deck.pdf"}]
WEB: list[dict[str, Any]] = [
    {"url": "https://www.unifi.it/a", "ingest_source": "crawl"},
    {"url": "https://www.unifi.it/a", "ingest_source": "crawl"},
    {"url": "https://www.unifi.it/a", "ingest_source": "live"},
    {"url": "https://www.unifi.it/b", "ingest_source": "live"},
]
CONTENTS = {COLLECTION: b"slides snapshot", WEB_COLLECTION: b"web snapshot"}

_SNAPSHOTS = re.compile(r"/collections/(\w+)/snapshots(?:/(.+))?")


def fill(client: QdrantClient, collection: str, payloads: Sequence[Mapping[str, Any]]) -> None:
    client.create_collection(
        collection, vectors_config=models.VectorParams(size=1, distance=models.Distance.DOT)
    )
    client.upsert(
        collection,
        [
            models.PointStruct(id=index, vector=[1.0], payload=dict(payload))
            for index, payload in enumerate(payloads)
        ],
    )


class FakeServer:
    """The REST endpoints `take` and `restore` call. An upload fills `target`
    with what `restored` names for the collection, the way a server would
    unpack the file."""

    def __init__(
        self,
        version: str = "1.19.1",
        checksum: str | None = None,
        target: QdrantClient | None = None,
        restored: Mapping[str, Sequence[Mapping[str, Any]]] | None = None,
    ) -> None:
        self.version = version
        self.checksum = checksum
        self.target = target
        self.restored = restored or {}
        self.calls: list[tuple[str, str]] = []
        self.uploads: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, request.url.path))
        if request.url.path == "/":
            return httpx.Response(200, json={"title": "qdrant", "version": self.version})
        match = _SNAPSHOTS.fullmatch(request.url.path)
        assert match is not None, request.url.path
        collection, name = match.groups()
        if request.method == "POST" and name is None:
            content = CONTENTS[collection]
            checksum = self.checksum or hashlib.sha256(content).hexdigest()
            snapshot = {
                "name": f"{collection}.snapshot",
                "size": len(content),
                "checksum": checksum,
            }
            return httpx.Response(200, json={"result": snapshot})
        if request.method == "GET":
            return httpx.Response(200, content=CONTENTS[collection])
        if request.method == "DELETE":
            return httpx.Response(200, json={"result": True})
        if request.method == "POST" and name == "upload":
            request.read()
            self.uploads.append(request)
            assert self.target is not None
            fill(self.target, collection, self.restored[collection])
            return httpx.Response(200, json={"result": True})
        raise AssertionError(f"unexpected {request.method} {request.url.path}")


def http_for(server: FakeServer) -> httpx.Client:
    return httpx.Client(base_url="http://qdrant.test", transport=httpx.MockTransport(server))


@pytest.fixture
def source(tmp_path: Path) -> Iterator[QdrantClient]:
    client = open_client(tmp_path / "source")
    fill(client, COLLECTION, SLIDES)
    fill(client, WEB_COLLECTION, WEB)
    yield client
    client.close()


@pytest.fixture
def target(tmp_path: Path) -> Iterator[QdrantClient]:
    client = open_client(tmp_path / "target")
    yield client
    client.close()


def test_take_downloads_every_collection_beside_its_counts_and_deletes_the_server_copy(
    source: QdrantClient, tmp_path: Path
) -> None:
    server = FakeServer()
    directory = take(http_for(server), source, tmp_path / "snapshots")

    assert directory.parent == tmp_path / "snapshots"
    assert sorted(path.name for path in directory.iterdir()) == [
        MANIFEST,
        f"{COLLECTION}.snapshot",
        f"{WEB_COLLECTION}.snapshot",
    ]
    assert (directory / f"{WEB_COLLECTION}.snapshot").read_bytes() == CONTENTS[WEB_COLLECTION]
    manifest = json.loads((directory / MANIFEST).read_text(encoding="utf-8"))
    assert manifest["qdrant_version"] == "1.19.1"
    slides = manifest["collections"][COLLECTION]
    assert (slides["points"], slides["versions"]) == (2, [[None, None, 2]])
    web = manifest["collections"][WEB_COLLECTION]
    assert web["points"] == 4
    assert web["versions"] == [
        ["https://www.unifi.it/a", "crawl", 2],
        ["https://www.unifi.it/a", "live", 1],
        ["https://www.unifi.it/b", "live", 1],
    ]
    assert web["sha256"] == hashlib.sha256(CONTENTS[WEB_COLLECTION]).hexdigest()
    assert web["size"] == len(CONTENTS[WEB_COLLECTION])
    assert ("DELETE", f"/collections/{COLLECTION}/snapshots/{COLLECTION}.snapshot") in server.calls
    assert ("DELETE", f"/collections/{WEB_COLLECTION}/snapshots/{WEB_COLLECTION}.snapshot") in (
        server.calls
    )


def test_take_leaves_no_file_that_does_not_match_the_server_checksum(
    source: QdrantClient, tmp_path: Path
) -> None:
    server = FakeServer(checksum="0" * 64)
    with pytest.raises(RuntimeError, match="sha256"):
        take(http_for(server), source, tmp_path / "snapshots")

    (directory,) = (tmp_path / "snapshots").iterdir()
    assert list(directory.iterdir()) == []
    # The server's copy goes even when the download is refused.
    assert ("DELETE", f"/collections/{COLLECTION}/snapshots/{COLLECTION}.snapshot") in server.calls


class _ResetStream(httpx.SyncByteStream):
    def __iter__(self) -> Iterator[bytes]:
        yield b"half a snapshot"
        raise httpx.ReadError("connection reset by peer")


class ResetDownload(FakeServer):
    """A server whose connection drops halfway through every download."""

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path != "/":
            self.calls.append((request.method, request.url.path))
            return httpx.Response(200, stream=_ResetStream())
        return super().__call__(request)


def test_take_leaves_no_partial_file_when_the_download_breaks(
    source: QdrantClient, tmp_path: Path
) -> None:
    server = ResetDownload()
    with pytest.raises(httpx.ReadError):
        take(http_for(server), source, tmp_path / "snapshots")

    (directory,) = (tmp_path / "snapshots").iterdir()
    assert list(directory.iterdir()) == []
    assert ("DELETE", f"/collections/{COLLECTION}/snapshots/{COLLECTION}.snapshot") in server.calls


@pytest.mark.parametrize(
    ("source_version", "target_version", "expected"),
    [
        ("1.19.1", "1.19.1", True),
        ("1.19.1", "1.19.3", True),
        ("1.19.1", "1.20.0", True),
        ("1.19.1", "1.19.0", False),
        ("1.19.1", "1.18.9", False),
        ("1.19.1", "1.21.0", False),
        ("1.19.1", "2.0.0", False),
    ],
)
def test_a_snapshot_restores_on_its_minor_version_or_the_next(
    source_version: str, target_version: str, expected: bool
) -> None:
    assert restorable(source_version, target_version) is expected


def test_restore_uploads_each_file_with_its_checksum_and_finds_the_counts_equal(
    source: QdrantClient, target: QdrantClient, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    directory = take(http_for(FakeServer()), source, tmp_path / "snapshots")
    server = FakeServer(target=target, restored={COLLECTION: SLIDES, WEB_COLLECTION: WEB})

    assert restore(http_for(server), target, directory)

    upload = next(request for request in server.uploads if WEB_COLLECTION in request.url.path)
    assert upload.url.params["priority"] == "snapshot"
    assert upload.url.params["checksum"] == hashlib.sha256(CONTENTS[WEB_COLLECTION]).hexdigest()
    assert CONTENTS[WEB_COLLECTION] in upload.content
    out = capsys.readouterr().out
    assert f"{WEB_COLLECTION}: points 4 / 4, (url, ingest_source) pairs 3 / 3, 0 differ" in out


def test_restore_reports_a_pair_whose_count_differs(
    source: QdrantClient, target: QdrantClient, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    directory = take(http_for(FakeServer()), source, tmp_path / "snapshots")
    # The live copy of page a is missing from what the server unpacked.
    server = FakeServer(
        target=target, restored={COLLECTION: SLIDES, WEB_COLLECTION: WEB[:2] + WEB[3:]}
    )

    assert not restore(http_for(server), target, directory)

    out = capsys.readouterr().out
    assert f"{WEB_COLLECTION}: points 4 / 3, (url, ingest_source) pairs 3 / 2, 1 differ" in out
    assert "https://www.unifi.it/a [live]: 1 / 0" in out


def test_restore_refuses_a_server_that_holds_a_collection_already(
    source: QdrantClient, target: QdrantClient, tmp_path: Path
) -> None:
    directory = take(http_for(FakeServer()), source, tmp_path / "snapshots")
    fill(target, WEB_COLLECTION, WEB[:1])
    server = FakeServer(target=target)

    with pytest.raises(SystemExit, match=WEB_COLLECTION):
        restore(http_for(server), target, directory)
    assert server.uploads == []


def test_restore_refuses_a_server_too_new_for_the_snapshots(
    source: QdrantClient, target: QdrantClient, tmp_path: Path
) -> None:
    directory = take(http_for(FakeServer()), source, tmp_path / "snapshots")
    server = FakeServer(version="1.21.0", target=target)

    with pytest.raises(SystemExit, match=r"1\.21\.0"):
        restore(http_for(server), target, directory)
    assert server.uploads == []


def test_the_snapshot_requests_carry_the_key_open_client_sends(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(env, "qdrant_api_key", SecretStr("k"))
    with server_http("http://127.0.0.1:6333") as http:
        assert http.headers["api-key"] == "k"
    monkeypatch.setattr(env, "qdrant_api_key", None)
    with server_http("http://127.0.0.1:6333") as http:
        assert "api-key" not in http.headers


def test_a_directory_is_no_server_to_snapshot(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--qdrant", str(tmp_path / "qdrant")])
    assert exit_info.value.code == 2
