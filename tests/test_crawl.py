"""The crawler's politeness and boundaries are code, not convention: robots
disallow, the page cap, the attachment size cap and scope filtering must all
hold against an in-memory fetcher — no test ever touches the network."""

import json
from pathlib import Path

import pytest

from rag.crawl import (
    DEFAULT_SCOPE,
    Outlink,
    RegistryEntry,
    Response,
    ScopeRule,
    Throttle,
    append_registry,
    crawl,
    extract_links,
    latest_by_url,
    read_registry,
    rule_for,
    rules_for_sections,
    sitemap_urls,
)

RULES = (ScopeRule(section="ingegneria", host="ingegneria.unifi.it"),)

SITEMAP = """<?xml version="1.0"?>
<urlset><url><loc>https://ingegneria.unifi.it/vp-185-per-laurearsi.html</loc></url>
<url><loc> https://ingegneria.unifi.it/vp-1-home.html </loc></url>
<url><loc>https://elsewhere.example.org/out-of-scope.html</loc></url></urlset>"""

LAUREARSI = """<html><body>
<a href="/vp-1-home.html">Home</a>
<a href="modulo_tesi.pdf">Modulo richiesta tesi</a>
<a href="/upload/Lista%20accordi.xlsx">Lista accordi</a>
<a href="/upload/domanda_semp.rtf">Domanda SEMP</a>
<a href="https://elsewhere.example.org/out.html">Fuori scope</a>
<a href="#section">Anchor only</a>
</body></html>"""


class StubFetcher:
    def __init__(self, pages: dict[str, Response]) -> None:
        self.pages = pages
        self.requested: list[str] = []

    def get(self, url: str) -> Response:
        self.requested.append(url)
        if url not in self.pages:
            raise ConnectionError(url)
        return self.pages[url]


def page(url: str, body: bytes, content_type: str = "text/html") -> Response:
    return Response(url=url, status=200, content_type=content_type, body=body)


def site(robots: str = "User-agent: *\nAllow: /\n") -> dict[str, Response]:
    base = "https://ingegneria.unifi.it"
    return {
        f"{base}/robots.txt": page(f"{base}/robots.txt", robots.encode(), "text/plain"),
        f"{base}/sitemap.xml": page(f"{base}/sitemap.xml", SITEMAP.encode(), "text/xml"),
        f"{base}/vp-185-per-laurearsi.html": page(
            f"{base}/vp-185-per-laurearsi.html", LAUREARSI.encode()
        ),
        f"{base}/vp-1-home.html": page(f"{base}/vp-1-home.html", b"<html>home</html>"),
        f"{base}/modulo_tesi.pdf": page(
            f"{base}/modulo_tesi.pdf", b"%PDF-1.4 fake", "application/pdf"
        ),
    }


def instant() -> Throttle:
    return Throttle(interval=0.0)


def test_rule_for_matches_host_and_prefix() -> None:
    assert rule_for("https://ingegneria.unifi.it/vp-1.html", RULES) is not None
    assert rule_for("https://elsewhere.example.org/x", RULES) is None
    assert rule_for("mailto:segreteria@unifi.it", RULES) is None


def test_sitemap_parse_is_lenient() -> None:
    urls = sitemap_urls(SITEMAP)
    assert "https://ingegneria.unifi.it/vp-185-per-laurearsi.html" in urls
    assert "https://ingegneria.unifi.it/vp-1-home.html" in urls  # whitespace stripped


def test_extract_links_absolutizes_and_drops_fragments() -> None:
    links = dict(extract_links("https://ingegneria.unifi.it/vp-185.html", LAUREARSI))
    assert links["https://ingegneria.unifi.it/modulo_tesi.pdf"] == "Modulo richiesta tesi"
    assert "https://ingegneria.unifi.it/vp-185.html" not in links  # the bare fragment
    assert all(not url.endswith("#section") for url in links)


def test_crawl_stays_in_scope_and_downloads_pdf_attachments(tmp_path: Path) -> None:
    fetcher = StubFetcher(site())
    snapshot = crawl(fetcher, tmp_path, rules=RULES, throttle=instant())

    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    fetched = {entry["url"] for entry in manifest["pages"]}
    assert "https://ingegneria.unifi.it/vp-185-per-laurearsi.html" in fetched
    assert "https://ingegneria.unifi.it/modulo_tesi.pdf" in fetched  # attachment followed
    assert all("elsewhere.example.org" not in url for url in fetcher.requested)

    entries = read_registry(tmp_path / "registry.jsonl")
    by_url = latest_by_url(entries)
    pdf = by_url["https://ingegneria.unifi.it/modulo_tesi.pdf"]
    assert pdf.referrer_url == "https://ingegneria.unifi.it/vp-185-per-laurearsi.html"
    assert pdf.ingest_source == "crawl"
    page_entry = by_url["https://ingegneria.unifi.it/vp-185-per-laurearsi.html"]
    modulo = Outlink(
        url="https://ingegneria.unifi.it/modulo_tesi.pdf", text="Modulo richiesta tesi"
    )
    assert modulo in page_entry.outlinks


def test_crawl_honors_robots_disallow(tmp_path: Path) -> None:
    fetcher = StubFetcher(site(robots="User-agent: *\nDisallow: /vp-185-per-laurearsi.html\n"))
    snapshot = crawl(fetcher, tmp_path, rules=RULES, throttle=instant())
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    fetched = {entry["url"] for entry in manifest["pages"]}
    assert "https://ingegneria.unifi.it/vp-185-per-laurearsi.html" not in fetched
    assert "https://ingegneria.unifi.it/vp-1-home.html" in fetched


def test_crawl_stops_hard_at_the_page_cap(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    fetcher = StubFetcher(site())
    with caplog.at_level("WARNING"):
        snapshot = crawl(fetcher, tmp_path, rules=RULES, max_pages=1, throttle=instant())
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    assert len(manifest["pages"]) == 1
    assert any("page cap" in record.message for record in caplog.records)


def test_oversized_attachment_is_skipped(tmp_path: Path) -> None:
    pages = site()
    url = "https://ingegneria.unifi.it/modulo_tesi.pdf"
    pages[url] = Response(
        url=url, status=200, content_type="application/pdf", body=b"x" * (20 * 1024 * 1024 + 1)
    )
    fetcher = StubFetcher(pages)
    snapshot = crawl(fetcher, tmp_path, rules=RULES, throttle=instant())
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    assert all(entry["url"] != url for entry in manifest["pages"])


def test_office_links_are_recorded_as_outlinks_but_never_fetched(tmp_path: Path) -> None:
    fetcher = StubFetcher(site())
    snapshot = crawl(fetcher, tmp_path, rules=RULES, throttle=instant())
    assert all(not url.lower().endswith((".xlsx", ".rtf")) for url in fetcher.requested)
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    page_entry = latest_by_url(read_registry(tmp_path / "registry.jsonl"))[
        "https://ingegneria.unifi.it/vp-185-per-laurearsi.html"
    ]
    outlink_urls = {outlink.url for outlink in page_entry.outlinks}
    assert "https://ingegneria.unifi.it/upload/Lista%20accordi.xlsx" in outlink_urls
    assert all(not entry["url"].endswith(".xlsx") for entry in manifest["pages"])


def test_extensionless_binary_content_type_is_skipped(tmp_path: Path) -> None:
    pages = site()
    base = "https://ingegneria.unifi.it"
    url = f"{base}/download?id=42"
    pages[f"{base}/vp-1-home.html"] = page(
        f"{base}/vp-1-home.html", b'<html><a href="/download?id=42">Modulo</a></html>'
    )
    pages[url] = page(url, b"PK\x03\x04 fake xlsx", "application/vnd.ms-excel")
    fetcher = StubFetcher(pages)
    snapshot = crawl(fetcher, tmp_path, rules=RULES, throttle=instant())
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    assert url in fetcher.requested  # no extension to filter on, so it was fetched...
    assert all(entry["url"] != url for entry in manifest["pages"])  # ...but never stored


def test_rules_for_sections_subsets_the_table_and_rejects_typos() -> None:
    subset = rules_for_sections(["servizi", "international"])
    assert {rule.section for rule in subset} == {"servizi", "international"}
    assert rules_for_sections([rule.section for rule in DEFAULT_SCOPE]) == DEFAULT_SCOPE
    with pytest.raises(ValueError, match="ingegneira"):
        rules_for_sections(["ingegneira"])


def test_registry_reader_skips_corrupt_lines(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    path = tmp_path / "registry.jsonl"
    good = RegistryEntry(
        url="https://ingegneria.unifi.it/a.html",
        content_hash="ab" * 32,
        fetch_date="2026-08-22",
        ingest_run_id="crawl-x",
    )
    append_registry(path, good)
    with path.open("a", encoding="utf-8") as handle:
        handle.write('{"url": "https://truncated\n')
    append_registry(path, good.model_copy(update={"content_hash": "cd" * 32}))

    with caplog.at_level("WARNING"):
        entries = read_registry(path)
    assert len(entries) == 2
    assert latest_by_url(entries)[good.url].content_hash == "cd" * 32
    assert any("corrupt registry line" in record.message for record in caplog.records)
