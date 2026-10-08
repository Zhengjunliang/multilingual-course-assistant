"""`GET /api/sources/<sha256>`: the PDF a slides citation came from.

The corpus and its parse sidecars are built under tmp_path, and the module's
two directories are pointed at them, so nothing here reads the real corpus.
Sidecars are written through `ParsedMeta` itself, the model `rag.parse` writes
them with, so a field the resolver reads cannot drift from what the parser
records.

Every response is closed: a `FileResponse` holds its file open, and the
suite's `filterwarnings = error` turns the unclosed handle into a failure.
"""

import hashlib
import logging
from pathlib import Path
from typing import Any, Literal

import pytest
from test_qa_api import client_for

from apps.qa import sources
from rag.parse import ParsedMeta

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n% a course deck\n%%EOF\n"
SHA = hashlib.sha256(PDF).hexdigest()
WEB_PAGE = b"a crawled page"
WEB_SHA = hashlib.sha256(WEB_PAGE).hexdigest()
SECRET = b"%PDF-1.4\n% not course material\n%%EOF\n"
SECRET_SHA = hashlib.sha256(SECRET).hexdigest()


def write_sidecar(
    parsed: Path, stem: str, source: Path, sha: str, kind: Literal["slides", "web"] = "slides"
) -> None:
    meta = ParsedMeta(
        source_file=source.name,
        source_path=str(source),
        source_sha256=sha,
        parse_variant="classic",
        docling_version="2.0.0",
        course="B028451",
        seconds=1.0,
        parsed_at="2026-09-29T00:00:00+00:00",
        academic_year="2025-2026",
        kind=kind,
    )
    (parsed / f"{stem}.classic.meta.json").write_text(meta.model_dump_json(), encoding="utf-8")


def read(response: Any) -> bytes:
    """Every byte of a file response, which is then closed.

    `Any` as in tests/test_qa_api.py: the test client's response type does not
    declare `streaming_content`.
    """
    try:
        return b"".join(response.streaming_content)
    finally:
        response.close()


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A corpus with one deck, a crawled page, and their sidecars."""
    corpus = tmp_path / "corpus"
    parsed = tmp_path / "parsed"
    (corpus / "PPM").mkdir(parents=True)
    (corpus / "web").mkdir()
    parsed.mkdir()

    deck = corpus / "PPM" / "deck (2).pdf"
    deck.write_bytes(PDF)
    write_sidecar(parsed, "deck (2)", deck, SHA)
    # Inside the corpus on purpose: only `kind` keeps it from being served.
    page = corpus / "web" / "p602.pdf"
    page.write_bytes(WEB_PAGE)
    write_sidecar(parsed, "p602", page, WEB_SHA, kind="web")
    # Matched by the sidecar glob and unreadable as a file: a key that scans
    # every sidecar reaches it, and must get the 404 of any other miss.
    (parsed / "zz-a-directory.meta.json").mkdir()

    monkeypatch.setattr(sources, "PARSED_DIR", parsed)
    monkeypatch.setattr(sources, "CORPUS_DIR", corpus)
    return tmp_path


def test_a_slides_source_opens_inline_as_the_indexed_pdf(root: Path) -> None:
    response = client_for().get(f"/api/sources/{SHA}")
    body = read(response)

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"].startswith("inline")
    assert "deck (2).pdf" in response["Content-Disposition"]
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Cache-Control"] == "private"
    assert response["ETag"] == f'"{SHA}"'
    assert "Content-Security-Policy" not in response
    assert body == PDF


@pytest.mark.parametrize(
    "sha",
    [
        pytest.param("0" * 64, id="unknown-sha"),
        pytest.param(SHA.upper(), id="uppercase-hex"),
        pytest.param(WEB_SHA, id="web-sidecar"),
    ],
)
def test_a_source_is_not_found(root: Path, sha: str) -> None:
    response = client_for().get(f"/api/sources/{sha}")
    response.close()

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("planted", "sha", "status"),
    [
        pytest.param("corpus/../secret.pdf", SECRET_SHA, 404, id="dotdot-404"),
        pytest.param("corpus-evil/secret.pdf", SECRET_SHA, 404, id="sibling-prefix-404"),
        pytest.param("corpus/../secret.pdf", SHA, 200, id="beside-a-good-one-200"),
    ],
)
def test_only_a_sidecar_inside_the_corpus_is_served(
    root: Path, caplog: pytest.LogCaptureFixture, planted: str, sha: str, status: int
) -> None:
    """A sidecar naming a real file outside the corpus is skipped.

    `corpus-evil` is the prefix trap: a string comparison would take it for a
    path inside `corpus`. In the last case the planted sidecar claims the good
    deck's hash and sorts before it ("a-" < "deck"), so it is read first and
    must not hide the good one.
    """
    outside = root / planted
    outside.resolve().parent.mkdir(exist_ok=True)
    outside.resolve().write_bytes(SECRET)
    write_sidecar(root / "parsed", "a-planted", outside, sha)

    with caplog.at_level(logging.WARNING, logger="apps.qa.sources"):
        response = client_for().get(f"/api/sources/{sha}")
        body = read(response) if response.status_code == 200 else b""
        response.close()

    assert response.status_code == status
    assert "skipped" in caplog.text
    if status == 200:
        assert body == PDF
