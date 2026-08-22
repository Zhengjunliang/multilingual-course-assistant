"""The web parse step must strip page chrome before Docling sees it, thread
the full provenance into the sidecar, and emit exactly the artifact pairs the
existing chunking step consumes. The HTML backend is declarative (no models),
so the end-to-end test runs the real conversion."""

import json
from pathlib import Path

from rag.chunk import collect_documents
from rag.crawl import RegistryEntry, append_registry
from rag.parse import ParsedMeta
from rag.webparse import html_lang, main, prune_html

PAGE = """<html lang="it-IT"><head><script>tracker()</script></head><body>
<nav><a href="/">Home</a></nav>
<h1>Per laurearsi</h1>
<p>La domanda di laurea va presentata online entro le scadenze.</p>
<footer>Contatti e cookie banner</footer>
</body></html>"""


def test_prune_drops_chrome_and_keeps_content() -> None:
    pruned = prune_html(PAGE)
    assert "domanda di laurea" in pruned
    assert "tracker()" not in pruned
    assert "cookie banner" not in pruned
    assert "<nav>" not in pruned


def test_html_lang_normalizes_or_degrades() -> None:
    assert html_lang(PAGE) == "it"
    assert html_lang("<html><body>x</body></html>") is None
    assert html_lang('<html lang="12"><body>x</body></html>') is None


def make_snapshot(tmp_path: Path) -> Path:
    url = "https://ingegneria.unifi.it/vp-185-per-laurearsi.html"
    snapshot = tmp_path / "crawl-20260822-000000"
    snapshot.mkdir()
    (snapshot / "abcd1234abcd1234.html").write_text(PAGE, encoding="utf-8")
    (snapshot / "manifest.json").write_text(
        json.dumps(
            {
                "run_id": "crawl-20260822-000000",
                "pages": [
                    {
                        "url": url,
                        "file": "abcd1234abcd1234.html",
                        "content_hash": "ee" * 32,
                        "fetch_date": "2026-08-22",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    append_registry(
        tmp_path / "registry.jsonl",
        RegistryEntry(
            url=url,
            content_hash="ee" * 32,
            fetch_date="2026-08-22",
            ingest_run_id="crawl-20260822-000000",
            section="ingegneria",
            referrer_url=None,
        ),
    )
    return snapshot


def test_snapshot_parses_into_chunkable_pairs(tmp_path: Path) -> None:
    snapshot = make_snapshot(tmp_path)
    out_dir = tmp_path / "webparsed"

    main([str(snapshot), "--out-dir", str(out_dir)])

    (doc_path,) = list(collect_documents(out_dir))  # sidecar pairing holds
    assert doc_path.name == "abcd1234abcd1234.html.json"
    meta = ParsedMeta.model_validate_json(
        (out_dir / "abcd1234abcd1234.html.meta.json").read_text(encoding="utf-8")
    )
    assert meta.kind == "web"
    assert meta.url == "https://ingegneria.unifi.it/vp-185-per-laurearsi.html"
    assert meta.ingest_source == "crawl"
    assert meta.lang == "it"
    assert meta.section == "ingegneria"
    assert meta.content_hash == "ee" * 32
    assert meta.source_sha256 == "ee" * 32  # chunk_id derives from the content hash
    assert meta.parse_variant == "html"

    from docling_core.types.doc.document import DoclingDocument

    document = DoclingDocument.load_from_json(doc_path)
    text = "\n".join(item.text for item in document.texts)
    assert "domanda di laurea" in text
    assert "tracker()" not in text
