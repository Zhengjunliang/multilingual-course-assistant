"""Scoped crawler for the campus web source: seed sections -> snapshot + registry.

Discovery is sitemap-first (the site's own page inventory) with link-BFS as the
fallback, filtered through a deterministic scope-rule table — the LLM relevance
gate exists only on the live/autogrow path, never here (design owned by
docs/fonte-web-unifi.md). Politeness is non-negotiable and lives in code, not
in a convention: robots.txt honored, one request per second, a hard page cap,
an honest User-Agent, attachments size-capped.

Every fetch lands in two artifacts with opposite lifecycles:
- `<out>/<run_id>/` — immutable snapshot (raw bytes + `manifest.json`), the
  corpus identity M3 evaluations cite;
- `<out>/registry.jsonl` — append-only global ledger (one row per fetch, last
  row per URL wins) serving the outlink graph, incremental refresh and
  rollback grouping. Single-process writer for the thesis phase; readers skip
  corrupt lines with a warning.

The real crawl is run by the user, never by the agent:

    uv run python -m rag.crawl --out data\\webcorpus
    uv run python -m rag.crawl --out data\\webcorpus --max-pages 50
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import time
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING, Protocol
from urllib import robotparser
from urllib.parse import urldefrag, urljoin, urlsplit

from pydantic import BaseModel, ConfigDict, Field

from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

logger = logging.getLogger(__name__)

USER_AGENT = (
    "multilingual-course-assistant/0.1 (UniFi bachelor thesis, retrieval index, not model training)"
)
REQUEST_INTERVAL_SECONDS = 1.0
DEFAULT_MAX_PAGES = 500
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 30.0

# Attachments are PDF-only: office files on these sites are blank fill-in
# templates (moduli), not content — links to them are never followed.
SKIPPED_EXTENSIONS = (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf", ".odt", ".zip")


class ScopeRule(BaseModel):
    """One row of the scope table (docs/fonte-web-unifi.md owns the table).

    Deliberately host+path based, not domain-locked: student-critical hosts
    outside unifi.it (DSU, CISIA...) enter as explicit rows.
    """

    model_config = ConfigDict(frozen=True)

    section: str
    host: str
    path_prefix: str = "/"


# Seed sections, kept in sync with the table in docs/fonte-web-unifi.md.
# Each path_prefix must be a real page: it doubles as the link-BFS seed URL
# (calibrated against the live site at the Stage 3.5 handover).
DEFAULT_SCOPE = (
    ScopeRule(section="ingegneria", host="ingegneria.unifi.it"),
    ScopeRule(section="servizi", host="www.unifi.it", path_prefix="/it/studia-con-noi"),
    ScopeRule(section="mobilita", host="www.unifi.it", path_prefix="/it/ateneo/nel-mondo"),
    ScopeRule(section="international", host="www.unifi.it", path_prefix="/en/"),
)


def rules_for_sections(
    names: Iterable[str], rules: Sequence[ScopeRule] = DEFAULT_SCOPE
) -> tuple[ScopeRule, ...]:
    """Subset of the scope table by section slug; unknown slugs are an error —
    a typo silently crawling nothing would read as an empty site."""
    wanted = set(names)
    unknown = wanted - {rule.section for rule in rules}
    if unknown:
        raise ValueError(f"unknown sections: {sorted(unknown)}")
    return tuple(rule for rule in rules if rule.section in wanted)


class Outlink(BaseModel):
    model_config = ConfigDict(frozen=True)

    url: str
    text: str


class RegistryEntry(BaseModel):
    """One append-only ledger row; field semantics shared with the chunk
    payload contract (docs/docling-e-pipeline.md 3.6)."""

    model_config = ConfigDict(frozen=True)

    url: str
    content_hash: str
    fetch_date: str
    ingest_run_id: str
    ingest_source: str = "crawl"
    trigger: str | None = None
    referrer_url: str | None = None
    section: str | None = None
    outlinks: list[Outlink] = Field(default_factory=list[Outlink])


class Response(BaseModel):
    model_config = ConfigDict(frozen=True)

    url: str
    status: int
    content_type: str
    body: bytes


class Fetcher(Protocol):
    """The one network surface: tests substitute an in-memory stub, the CLI
    builds the httpx-backed real thing."""

    def get(self, url: str) -> Response: ...


class HttpxFetcher:
    def __init__(self) -> None:
        import httpx

        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
        )

    def get(self, url: str) -> Response:
        reply = self._client.get(url)
        return Response(
            url=str(reply.url),
            status=reply.status_code,
            content_type=reply.headers.get("content-type", ""),
            body=reply.content,
        )


def is_pdf(url: str, content_type: str) -> bool:
    """PDF by declared type or by extension: an extensionless download URL and
    a server that types everything `application/octet-stream` each need the
    other half. Shared with the live ingest path, which routes on the same
    judgment."""
    return "pdf" in content_type or url.lower().endswith(".pdf")


def supported_content(url: str, content_type: str) -> bool:
    """The second net after the link filter: extensionless office/binary URLs
    slip past it, and the content type is what stops them
    (`application/xhtml+xml` stays in). Shared with the live ingest path — a
    student can paste the same kind of URL the crawler stumbles on."""
    if is_pdf(url, content_type):
        return True
    return not (content_type.startswith("application/") and "html" not in content_type)


def rule_for(url: str, rules: Sequence[ScopeRule]) -> ScopeRule | None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return None
    for rule in rules:
        if parts.hostname == rule.host and parts.path.startswith(rule.path_prefix):
            return rule
    return None


class _LinkParser(HTMLParser):
    """Anchor extraction on stdlib only: bs4 belongs to the parse step, and a
    crawler needs hrefs plus anchor text, nothing more."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []  # (href, anchor text)
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join("".join(self._text).split())))
            self._href = None


def extract_links(base_url: str, html: str) -> list[tuple[str, str]]:
    """Absolute, fragment-free outlinks with their anchor text; self-links
    (fragment-only anchors resolve to the page itself) are noise in the
    outlink graph and are dropped."""
    parser = _LinkParser()
    parser.feed(html)
    self_url = urldefrag(base_url).url
    seen: dict[str, str] = {}
    for href, text in parser.links:
        absolute = urldefrag(urljoin(base_url, href)).url
        if (
            absolute.startswith(("http://", "https://"))
            and absolute != self_url
            and absolute not in seen
        ):
            seen[absolute] = text
    return list(seen.items())


# Sitemaps in the wild (sitemap.php included) are not always valid XML, so the
# parse is a lenient regex for <loc> entries rather than an XML tree.
_LOC = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.IGNORECASE | re.DOTALL)


def sitemap_urls(xml_text: str) -> list[str]:
    return [match.strip() for match in _LOC.findall(xml_text) if match.strip()]


class RobotsCache:
    """One robots.txt fetch per host; unreachable robots means allow (the
    standard's own default), a parseable one is honored strictly."""

    def __init__(self, fetcher: Fetcher) -> None:
        self._fetcher = fetcher
        # None = no reachable robots.txt for the host -> allow, the standard's
        # own default.
        self._parsers: dict[str, robotparser.RobotFileParser | None] = {}

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        host = parts.hostname or ""
        if host not in self._parsers:
            parser: robotparser.RobotFileParser | None = None
            try:
                reply = self._fetcher.get(f"{parts.scheme}://{host}/robots.txt")
                if reply.status == 200:
                    parser = robotparser.RobotFileParser()
                    parser.parse(reply.body.decode("utf-8", errors="replace").splitlines())
            except Exception:  # unreachable robots stays None -> allow
                parser = None
            self._parsers[host] = parser
        cached = self._parsers[host]
        return True if cached is None else cached.can_fetch(USER_AGENT, url)


class Throttle:
    """Minimum interval between any two requests; injectable clock/sleep so
    tests run instantly."""

    def __init__(self, interval: float = REQUEST_INTERVAL_SECONDS) -> None:
        self._interval = interval
        self._last = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        remaining = self._interval - (now - self._last)
        if remaining > 0:
            time.sleep(remaining)
        self._last = time.monotonic()


def append_registry(path: Path, entry: RegistryEntry) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(entry.model_dump_json() + "\n")


def read_registry(path: Path) -> list[RegistryEntry]:
    """Corrupt lines are skipped with a warning, never fatal: the ledger must
    survive an interrupted append."""
    if not path.is_file():
        return []
    entries: list[RegistryEntry] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            entries.append(RegistryEntry.model_validate_json(line))
        except ValueError:
            logger.warning("%s:%d: corrupt registry line skipped", path.name, number)
    return entries


def latest_by_url(entries: Iterable[RegistryEntry]) -> dict[str, RegistryEntry]:
    latest: dict[str, RegistryEntry] = {}
    for entry in entries:
        latest[entry.url] = entry
    return latest


def artifact_name(url: str, suffix: str) -> str:
    """Stable per-URL artifact stem: URL paths across a site collide on
    basenames (`index.html` everywhere), hashes never do. Shared with the live
    ingest path so the same URL keeps one identity whichever way it arrived."""
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16] + suffix


def crawl(
    fetcher: Fetcher,
    out_dir: Path,
    rules: Sequence[ScopeRule] = DEFAULT_SCOPE,
    max_pages: int = DEFAULT_MAX_PAGES,
    throttle: Throttle | None = None,
) -> Path:
    """BFS within the scope table; returns the snapshot directory.

    HTML pages enqueue their in-scope outlinks; linked PDFs are downloaded as
    leaf attachments (never expanded). The page cap is a hard stop with the
    drop logged — a silently truncated crawl would read as full coverage.
    """
    run_id = "crawl-" + datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    snapshot = out_dir / run_id
    snapshot.mkdir(parents=True, exist_ok=True)
    registry_path = out_dir / "registry.jsonl"
    robots = RobotsCache(fetcher)
    throttle = throttle or Throttle()

    queue: list[tuple[str, str | None]] = []  # (url, referrer)
    seen: set[str] = set()
    sitemap_hosts: set[str] = set()
    for rule in rules:
        if rule.host not in sitemap_hosts:
            sitemap_hosts.add(rule.host)
            for name in ("sitemap.xml", "sitemap.php"):
                try:
                    throttle.wait()
                    reply = fetcher.get(f"https://{rule.host}/{name}")
                except Exception:  # a host without this sitemap flavor, not an error
                    logger.info("https://%s/%s: not available", rule.host, name)
                    continue
                if reply.status != 200:
                    continue
                for url in sitemap_urls(reply.body.decode("utf-8", errors="replace")):
                    if (
                        rule_for(url, rules)
                        and url not in seen
                        and not url.lower().endswith(SKIPPED_EXTENSIONS)
                    ):
                        seen.add(url)
                        queue.append((url, None))
        root = f"https://{rule.host}{rule.path_prefix}"
        if root not in seen:  # link-BFS fallback seed when sitemaps are missing
            seen.add(root)
            queue.append((root, None))

    manifest_pages: list[dict[str, object]] = []
    fetched = 0
    while queue:
        if fetched >= max_pages:
            logger.warning(
                "page cap %d reached with %d URLs still queued — coverage is partial",
                max_pages,
                len(queue),
            )
            break
        url, referrer = queue.pop(0)
        rule = rule_for(url, rules)
        if rule is None or not robots.allowed(url):
            continue
        throttle.wait()
        try:
            reply = fetcher.get(url)
        except Exception:  # one dead URL must not end the run
            logger.warning("%s: fetch failed, skipping", url)
            continue
        if reply.status != 200:
            logger.info("%s: HTTP %d, skipping", url, reply.status)
            continue
        fetched += 1

        pdf = is_pdf(url, reply.content_type)
        if pdf and len(reply.body) > MAX_ATTACHMENT_BYTES:
            logger.warning("%s: attachment over %d bytes, skipped", url, MAX_ATTACHMENT_BYTES)
            continue
        if not supported_content(url, reply.content_type):
            logger.info("%s: unsupported content type %s, skipped", url, reply.content_type)
            continue
        name = artifact_name(url, ".pdf" if pdf else ".html")
        (snapshot / name).write_bytes(reply.body)

        outlinks: list[Outlink] = []
        if not pdf:
            html = reply.body.decode("utf-8", errors="replace")
            for link, text in extract_links(url, html):
                outlinks.append(Outlink(url=link, text=text))
                lowered = link.lower()
                follow = not lowered.endswith(SKIPPED_EXTENSIONS) and (
                    lowered.endswith(".pdf") or rule_for(link, rules) is not None
                )
                if follow and link not in seen:
                    seen.add(link)
                    queue.append((link, url))

        fetch_date = datetime.now(UTC).date().isoformat()
        content_hash = hashlib.sha256(reply.body).hexdigest()
        append_registry(
            registry_path,
            RegistryEntry(
                url=url,
                content_hash=content_hash,
                fetch_date=fetch_date,
                ingest_run_id=run_id,
                referrer_url=referrer,
                section=rule.section,
                outlinks=outlinks,
            ),
        )
        manifest_pages.append(
            {"url": url, "file": name, "content_hash": content_hash, "fetch_date": fetch_date}
        )

    manifest = {
        "run_id": run_id,
        "created_at": datetime.now(UTC).isoformat(),
        "rules": [rule.model_dump() for rule in rules],
        "max_pages": max_pages,
        "pages": manifest_pages,
    }
    (snapshot / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("%s: %d artifacts -> %s", run_id, len(manifest_pages), snapshot)
    return snapshot


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="webcorpus root directory")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES)
    parser.add_argument(
        "--sections",
        default=None,
        help="comma-separated subset of the scope table (default: all sections); "
        "lets a follow-up run spend the page cap on new sections only",
    )
    args = parser.parse_args(argv)

    configure_cli_logging()
    rules = rules_for_sections(args.sections.split(",")) if args.sections else DEFAULT_SCOPE
    snapshot = crawl(HttpxFetcher(), args.out, rules=rules, max_pages=args.max_pages)
    print(f"snapshot: {snapshot}")


if __name__ == "__main__":
    main()
