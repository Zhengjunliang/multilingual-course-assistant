"""Web-source parse step: crawl snapshot -> DoclingDocument JSON + sidecar.

Consumes a snapshot directory written by `rag.crawl` (raw artifacts +
`manifest.json`, with provenance looked up in the registry) and emits the same
artifact pairs `rag.chunk` already consumes — the web path converges into the
existing pipeline at the earliest possible point, so chunking and indexing
need zero web-specific branches beyond the contract fields.

HTML goes through a bs4 pre-prune (script/style/nav/header/footer and friends
dropped before Docling ever sees the page) and then Docling's HTML backend,
which is declarative — no layout models, no OCR, no GPU. PDF attachments go
through the classic PDF pipeline reused from `rag.parse` and keep its truthful
`classic` variant name; only pages are `html`.

Artifact stems reuse the snapshot's url-hash names: URL paths across a site
collide on basenames (`index.html` everywhere), hashes never do.

    uv run python -m rag.webparse data/webcorpus/crawl-20260822-120000
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from rag.crawl import RegistryEntry, latest_by_url, read_registry
from rag.parse import ParsedMeta, build_converter, docling_version, persist
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from docling.document_converter import DocumentConverter
    from docling_core.types.doc.document import DoclingDocument

logger = logging.getLogger(__name__)

DEFAULT_OUT_ROOT = Path(__file__).resolve().parent.parent / "data" / "webparsed"

# Structural noise stripped before conversion: navigation, chrome and code the
# retrieval index must never surface as content.
_PRUNE_TAGS = ("script", "style", "nav", "header", "footer", "aside", "form", "noscript")


def prune_html(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag_name in _PRUNE_TAGS:
        for tag in soup.find_all(tag_name):
            tag.decompose()
    return str(soup)


def html_lang(html: str) -> str | None:
    """`<html lang>` normalized to its primary subtag; junk degrades to None
    (the chunking heuristic takes over)."""
    from bs4 import BeautifulSoup
    from bs4.element import Tag

    root = BeautifulSoup(html, "html.parser").find("html")
    if not isinstance(root, Tag):
        return None
    declared = root.get("lang")
    if not isinstance(declared, str):
        return None
    subtag = declared.strip().lower().replace("_", "-").split("-")[0]
    return subtag if 2 <= len(subtag) <= 3 and subtag.isalpha() else None


def build_html_converter() -> DocumentConverter:
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter

    return DocumentConverter(allowed_formats=[InputFormat.HTML])


def convert_html(pruned_html: str, name: str, converter: DocumentConverter) -> DoclingDocument:
    from io import BytesIO

    from docling.datamodel.base_models import DocumentStream

    stream = DocumentStream(name=f"{name}.html", stream=BytesIO(pruned_html.encode("utf-8")))
    return converter.convert(stream).document


def meta_for(entry: RegistryEntry, *, artifact: Path, variant: str, lang: str | None) -> ParsedMeta:
    """The sidecar carries the whole web provenance so downstream steps read
    one contract (docs/docling-e-pipeline.md 3.6): `source_file` reuses the
    snapshot's url-hash artifact name (basenames collide site-wide, hashes
    don't; the URL itself lives in `url`), and `source_sha256` doubles as the
    raw-bytes content hash so chunk ids change with the page content."""
    return ParsedMeta(
        source_file=f"{artifact.stem}{Path(urlsplit(entry.url).path).suffix or '.html'}",
        source_path=str(artifact),
        source_sha256=entry.content_hash,
        parse_variant=variant,
        docling_version=docling_version(),
        course=entry.section or "web",
        seconds=0.0,
        parsed_at=entry.fetch_date,
        kind="web",
        lang=lang,
        url=entry.url,
        referrer_url=entry.referrer_url,
        fetch_date=entry.fetch_date,
        section=entry.section,
        ingest_run_id=entry.ingest_run_id,
        ingest_source="crawl" if entry.ingest_source == "crawl" else "live",
        trigger=entry.trigger,
        content_hash=entry.content_hash,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "snapshot", type=Path, help="a crawl snapshot directory (with manifest.json)"
    )
    parser.add_argument(
        "--registry", type=Path, default=None, help="default: <snapshot>/../registry.jsonl"
    )
    parser.add_argument(
        "--out-dir", type=Path, default=None, help="default: data/webparsed/<run_id>"
    )
    args = parser.parse_args(argv)

    configure_cli_logging()
    manifest = json.loads((args.snapshot / "manifest.json").read_text(encoding="utf-8"))
    registry_path = args.registry or args.snapshot.parent / "registry.jsonl"
    by_url = latest_by_url(read_registry(registry_path))
    out_dir = args.out_dir or DEFAULT_OUT_ROOT / manifest["run_id"]
    out_dir.mkdir(parents=True, exist_ok=True)

    html_converter = build_html_converter()
    pdf_converter = None  # built lazily: a snapshot without attachments never loads the models

    pages = manifest["pages"]
    failed = 0
    for page in pages:
        artifact = args.snapshot / page["file"]
        entry = by_url.get(page["url"])
        try:
            if entry is None:
                raise ValueError("no registry entry for this url")
            if artifact.suffix == ".pdf":
                if pdf_converter is None:
                    pdf_converter = build_converter("classic")
                document = pdf_converter.convert(artifact).document
                meta = meta_for(entry, artifact=artifact, variant="classic", lang=None)
            else:
                raw = artifact.read_text(encoding="utf-8", errors="replace")
                pruned = prune_html(raw)
                document = convert_html(pruned, artifact.stem, html_converter)
                meta = meta_for(entry, artifact=artifact, variant="html", lang=html_lang(raw))
            persist(document, meta, out_dir)
        except Exception:
            # One bad artifact must not lose the rest of the snapshot run.
            logger.exception("%s: web parse failed", page["url"])
            failed += 1
            continue
        logger.info("%s -> %s", page["url"], out_dir)

    print(f"parsed {len(pages) - failed}/{len(pages)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
