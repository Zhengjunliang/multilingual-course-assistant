"""Live ingest is the only query-time writer into the shared index, so what
these tests pin is its boundary: a gated page replaces exactly its own live
version and leaves the crawl snapshot alone, while a refused — or unparseable —
gate writes nothing at all and still hands back the chunks this turn answers
from. Robots, the CPU/page caps and the Ollama unload are code, not convention.
Everything runs offline: stub fetcher, stub completer, stub encoders and an
embedded Qdrant under tmp_path."""

from collections.abc import Iterator, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from qdrant_client import QdrantClient
from test_agent import ScriptedCompleter
from test_crawl import StubFetcher, page
from test_index import StubDense, StubSparse, make_chunk, make_web_chunk
from test_llm import StubCompleter
from test_probe import build_pdf

from rag.chunk import Chunk
from rag.crawl import Outlink, Response, Throttle, read_registry
from rag.index import (
    WEB_COLLECTION,
    delete_by_run,
    delete_web_versions,
    ensure_collection,
    index_chunks,
    open_client,
)
from rag.live import (
    GATE_FALLBACK_REASON,
    LIVE_MAX_PDF_PAGES,
    PDF_PARSE_TIMEOUT_SECONDS,
    LiveResult,
    fetch_and_ingest,
    gate_sample,
    live_chunker,
    live_html_converter,
    live_pdf_converter,
    main,
    maybe_unload_llm,
    run_gate_measurement,
    shared_robots,
    shared_throttle,
)
from rag.parse import ParsedMeta

URL = "https://www.dsu.toscana.it/borsa-di-studio"
PDF_URL = "https://ingegneria.unifi.it/modulo_tesi.pdf"
PDF_ROBOTS = "https://ingegneria.unifi.it/robots.txt"
ROBOTS = "https://www.dsu.toscana.it/robots.txt"
MODULO = "https://www.dsu.toscana.it/modulo-borsa.pdf"

PAGE = b"""<html lang="it"><head><script>tracker()</script></head><body>
<nav><a href="/">Home</a></nav>
<h1>Borsa di studio</h1><p>La domanda va presentata entro settembre.</p>
<a href="/modulo-borsa.pdf">Modulo borsa di studio</a>
</body></html>"""

# A one-page PDF carrying a real text layer: what the gate's pre-parse sniff is
# supposed to find, and what a filename alone never says.
PDF_TEXT = b"BT /F1 12 Tf 20 100 Td (Modulo richiesta posto alloggio Santa Monaca) Tj ET"
PDF_OBJECTS = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R"
    b" /Resources << /Font << /F1 5 0 R >> >> >>",
    b"<< /Length %d >>\nstream\n" % len(PDF_TEXT) + PDF_TEXT + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]

RELEVANT = '{"relevant": true, "reason": "campus service page"}'
IRRELEVANT = '{"relevant": false, "reason": "commercial page"}'

RUN_ID = "live-20260823-120000"


def site(robots: str = "User-agent: *\nAllow: /\n") -> dict[str, Response]:
    return {
        ROBOTS: page(ROBOTS, robots.encode(), "text/plain"),
        URL: page(URL, PAGE),
    }


def pdf_site() -> dict[str, Response]:
    return {
        PDF_ROBOTS: page(PDF_ROBOTS, b"User-agent: *\nAllow: /\n", "text/plain"),
        PDF_URL: page(PDF_URL, b"%PDF-1.4 fake", "application/pdf"),
    }


@pytest.fixture(autouse=True)
def _fresh_process_caches() -> Iterator[None]:
    """Converters, chunker, throttle and robots cache are process-wide on
    purpose (reloading docling's models per fetch would eat the step budget);
    tests must not inherit one another's stubs or robots answers."""
    providers = (
        live_chunker,
        live_pdf_converter,
        live_html_converter,
        shared_throttle,
        shared_robots,
    )
    for provider in providers:
        provider.cache_clear()
    yield
    for provider in providers:
        provider.cache_clear()


def fake_chunk_document(
    document: object, chunker: object, meta: ParsedMeta, locale: str
) -> list[Chunk]:
    """Stands in for the real chunker, whose tokenizer is a hub download. The
    payload fields the write path is judged on all come from the sidecar, so
    they stay real."""
    return [
        make_chunk(0, "La domanda va presentata entro settembre.", locale).model_copy(
            update={
                "chunk_id": f"{meta.source_sha256[:16]}:{meta.parse_variant}:0000",
                "kind": "web",
                "parse_variant": meta.parse_variant,
                "url": meta.url,
                "ingest_source": meta.ingest_source,
                "ingest_run_id": meta.ingest_run_id,
                "trigger": meta.trigger,
                "content_hash": meta.content_hash,
            }
        )
    ]


@pytest.fixture
def stub_chunking(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("rag.live.live_chunker", lambda: None)
    monkeypatch.setattr("rag.live.chunk_document", fake_chunk_document)


@pytest.fixture
def recorded_deletes(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[tuple[str, str]], str]]:
    """A scoped delete leaves no trace to assert on afterwards — an ephemeral
    fetch that wrongly deleted the crawl version of a page would look exactly
    like one that touched nothing. So the call itself is recorded."""
    calls: list[tuple[list[tuple[str, str]], str]] = []

    def recording_delete(
        client: QdrantClient, pairs: Sequence[tuple[str, str]], collection: str
    ) -> None:
        calls.append((list(pairs), collection))
        delete_web_versions(client, pairs, collection)

    monkeypatch.setattr("rag.live.delete_web_versions", recording_delete)
    return calls


@pytest.fixture
def web_client(tmp_path: Path) -> Iterator[QdrantClient]:
    client = open_client(tmp_path / "qdrant")
    ensure_collection(client, StubDense().dimension(), WEB_COLLECTION)
    yield client
    client.close()


def ingest(
    client: QdrantClient,
    fetcher: StubFetcher,
    reply: str,
    registry: Path,
    url: str = URL,
    trigger: str | None = "g001",
) -> LiveResult:
    return fetch_and_ingest(
        url,
        fetcher=fetcher,
        completer=StubCompleter(reply),
        client=client,
        dense=StubDense(),
        sparse=StubSparse(),
        run_id=RUN_ID,
        trigger=trigger,
        registry_path=registry,
        collection=WEB_COLLECTION,
        throttle=Throttle(interval=0.0),
    )


def payloads(client: QdrantClient) -> list[dict[str, Any]]:
    points, _ = client.scroll(WEB_COLLECTION, limit=100, with_payload=True)
    return [dict(point.payload or {}) for point in points]


def test_gate_sample_strips_markup_and_peeks_at_a_pdf_first_page() -> None:
    """The gate runs before parsing, so both samples are cheap: HTML degrades to
    visible text, a PDF to the text layer of page one. Judging a modulo on its
    filename alone was a measured gate failure — and an unreadable PDF still has
    to degrade to the URL, never to an exception."""
    sample = gate_sample(URL, page(URL, PAGE))
    assert "Borsa di studio" in sample
    assert "tracker()" not in sample
    assert "<h1>" not in sample

    readable = page(PDF_URL, build_pdf(PDF_OBJECTS), "application/pdf")
    assert "Santa Monaca" in gate_sample(PDF_URL, readable)
    assert gate_sample(PDF_URL, page(PDF_URL, b"%PDF-1.4 fake", "application/pdf")) == ""


def test_a_gated_page_persists_and_replaces_only_its_own_live_version(
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The write path's whole contract in one run: the crawl snapshot version of
    the same URL survives, the previous live version does not, and the registry
    row says who triggered the fetch and under which run."""
    index_chunks(
        web_client,
        [make_web_chunk("aa" * 32, "crawl", URL), make_web_chunk("bb" * 32, "live", URL)],
        StubDense(),
        StubSparse(),
        WEB_COLLECTION,
    )

    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, StubFetcher(site()), RELEVANT, registry)

    assert result.persisted is True
    assert result.chunks
    assert recorded_deletes == [([(URL, "live")], WEB_COLLECTION)]

    by_source = {str(payload["ingest_source"]): payload for payload in payloads(web_client)}
    assert by_source["crawl"]["content_hash"] == "aa" * 32  # snapshot untouched
    assert by_source["live"]["content_hash"] != "bb" * 32  # stale live version replaced
    assert by_source["live"]["ingest_run_id"] == RUN_ID
    assert by_source["live"]["trigger"] == "g001"

    (entry,) = read_registry(registry)
    assert (entry.url, entry.ingest_source, entry.trigger) == (URL, "live", "g001")
    assert entry.ingest_run_id == RUN_ID
    # The outlink graph is what the deepening loop picks candidates from, so a
    # live row that dropped it would make the page a dead end.
    modulo = Outlink(url=MODULO, text="Modulo borsa di studio")
    assert modulo in entry.outlinks
    assert result.outlinks == entry.outlinks  # and this turn gets them without refetching


def test_an_unchanged_page_is_never_re_parsed_or_written_twice(
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The ledger's incremental duty: identical bytes mean the stored version is
    still the current one, so the second fetch pays for neither the parse — the
    expensive half of the step — nor the write. The outlinks come off the ledger
    row instead, which is what keeps the deepening loop's candidate graph intact
    across a skip. The page is still fetched: only the bytes can say so."""
    registry = tmp_path / "registry.jsonl"
    fetcher = StubFetcher(site())
    first = ingest(web_client, fetcher, RELEVANT, registry)
    again = ingest(web_client, fetcher, RELEVANT, registry)

    assert fetcher.requested.count(URL) == 2
    assert again.persisted is True  # stored, it simply did not have to be written again
    assert again.chunks == []
    assert again.outlinks == first.outlinks
    assert recorded_deletes == [([(URL, "live")], WEB_COLLECTION)]
    assert web_client.count(WEB_COLLECTION).count == 1
    assert len(read_registry(registry)) == 1


def test_changed_content_replaces_the_stored_version_and_appends_a_row(
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The other half of the same check: a page that moved is re-parsed and
    re-indexed, and the ledger keeps both fetches — the append-only history is
    what tells a stale answer from a page that never changed."""
    registry = tmp_path / "registry.jsonl"
    ingest(web_client, StubFetcher(site()), RELEVANT, registry)
    updated = site()
    updated[URL] = page(URL, PAGE.replace(b"settembre", b"ottobre"))

    result = ingest(web_client, StubFetcher(updated), RELEVANT, registry)

    assert result.persisted is True
    assert result.chunks
    assert len(recorded_deletes) == 2
    rows = read_registry(registry)
    assert len(rows) == 2
    assert rows[0].content_hash != rows[1].content_hash
    # Only the new version is retrievable: the check skips writes, never cleanups.
    assert [payload["content_hash"] for payload in payloads(web_client)] == [rows[1].content_hash]


def test_a_rolled_back_page_is_re_indexed_although_the_ledger_says_unchanged(
    web_client: QdrantClient, tmp_path: Path, stub_chunking: None
) -> None:
    """A rollback deletes points, not ledger rows — the registry is append-only.
    So the incremental check asks the index as well: after `delete_by_run` the
    same bytes must be indexed again, or the acceptance run that rolls the live
    layer back before it starts would keep scoring an empty knowledge base."""
    registry = tmp_path / "registry.jsonl"
    fetcher = StubFetcher(site())
    ingest(web_client, fetcher, RELEVANT, registry)
    delete_by_run(web_client, RUN_ID, WEB_COLLECTION)
    assert web_client.count(WEB_COLLECTION).count == 0

    result = ingest(web_client, fetcher, RELEVANT, registry)

    assert result.persisted is True
    assert result.chunks  # parsed again, not skipped on the surviving ledger row
    assert web_client.count(WEB_COLLECTION).count == 1
    assert len(read_registry(registry)) == 2


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (IRRELEVANT, "commercial page"),
        ("I am afraid I cannot answer that", GATE_FALLBACK_REASON),
    ],
)
def test_a_refused_or_unusable_gate_stores_nothing_but_still_answers(
    reply: str,
    reason: str,
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The ephemeral branch: no delete, no upsert, no registry row — and chunks
    all the same, because a 4B gate misjudging a pasted link must not cost the
    student the answer."""
    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, StubFetcher(site()), reply, registry)

    assert result.persisted is False
    assert result.chunks
    assert result.verdict.reason == reason
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0
    assert not registry.exists()


def test_a_disallowed_url_is_never_fetched_and_never_stored(
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    fetcher = StubFetcher(site(robots="User-agent: *\nDisallow: /borsa-di-studio\n"))
    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, fetcher, RELEVANT, registry)

    assert URL not in fetcher.requested  # robots.txt only
    assert result.persisted is False
    assert result.chunks == []
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0
    assert not registry.exists()


def stub_pdf_converter(
    monkeypatch: pytest.MonkeyPatch,
    built: list[dict[str, Any]],
    converted: list[dict[str, Any]],
    status: str,
) -> None:
    """Replace the cached PDF converter's builder, so no docling model loads."""
    from docling.datamodel.base_models import ConversionStatus

    class RecordingConverter:
        def convert(self, source: object, **kwargs: Any) -> Any:
            converted.append(kwargs)
            return SimpleNamespace(
                document=SimpleNamespace(texts=[]), status=ConversionStatus(status)
            )

    def fake_build_converter(pipeline: str, **kwargs: Any) -> RecordingConverter:
        built.append({"pipeline": pipeline, **kwargs})
        return RecordingConverter()

    monkeypatch.setattr("rag.live.build_converter", fake_build_converter)


def test_pdf_ingest_runs_on_cpu_under_the_page_and_timeout_caps(
    web_client: QdrantClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stub_chunking: None
) -> None:
    """The live caps land in different places, and each one is a VRAM or
    step-budget decision: device and timeout on the pipeline options, the page
    cap on the conversion call. The cap must be a `page_range`, not
    `max_num_pages` — docling rejects a whole document that exceeds the latter,
    losing exactly the long decrees the cap exists to make usable."""
    built: list[dict[str, Any]] = []
    converted: list[dict[str, Any]] = []
    stub_pdf_converter(monkeypatch, built, converted, "success")

    result = ingest(
        web_client, StubFetcher(pdf_site()), RELEVANT, tmp_path / "registry.jsonl", url=PDF_URL
    )

    assert result.persisted is True
    assert built == [
        {"pipeline": "classic", "device": "cpu", "document_timeout": PDF_PARSE_TIMEOUT_SECONDS}
    ]
    assert converted == [{"page_range": (1, LIVE_MAX_PDF_PAGES)}]


def test_the_pdf_converter_is_built_once_and_reused(
    web_client: QdrantClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stub_chunking: None
) -> None:
    """Docling caches its initialized pipelines per converter instance: a
    converter per fetch would reload layout + TableFormer inside every step."""
    built: list[dict[str, Any]] = []
    converted: list[dict[str, Any]] = []
    stub_pdf_converter(monkeypatch, built, converted, "success")

    # Two attachments rather than the same one twice: an unchanged page is the
    # incremental check's business and never reaches a converter at all.
    other = PDF_URL.replace("modulo_tesi", "modulo_borsa")
    pages = pdf_site()
    pages[other] = page(other, b"%PDF-1.4 other", "application/pdf")
    registry = tmp_path / "registry.jsonl"
    for url in (PDF_URL, other):
        ingest(web_client, StubFetcher(pages), RELEVANT, registry, url=url)

    assert len(built) == 1
    assert len(converted) == 2


def test_a_timed_out_conversion_answers_this_turn_but_is_never_stored(
    web_client: QdrantClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """`document_timeout` does not raise: docling returns PARTIAL_SUCCESS with a
    truncated document. Storing it would freeze the truncation — the chunks
    carry the *whole* file's content_hash, so no later fetch would see a change
    and repair it. Ephemeral instead."""
    stub_pdf_converter(monkeypatch, [], [], "partial_success")

    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, StubFetcher(pdf_site()), RELEVANT, registry, url=PDF_URL)

    assert result.verdict.relevant is True  # the gate wanted it...
    assert result.persisted is False  # ...the parse did not finish
    assert result.chunks  # still usable for this turn
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0
    assert not registry.exists()


def test_a_half_converted_page_answers_this_turn_but_is_never_stored(
    web_client: QdrantClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The HTML branch reads the same `ConversionStatus` as the PDF branch, and
    for the same reason: chunks of a half-converted page would be indexed under
    the *whole* document's content_hash, so the incremental check would see no
    change and no later fetch would ever repair it. Assuming HTML always
    succeeds would freeze exactly those pages."""
    from docling.datamodel.base_models import ConversionStatus

    class HalfConverter:
        def convert(self, source: object, **kwargs: Any) -> Any:
            return SimpleNamespace(
                document=SimpleNamespace(texts=[]),
                status=ConversionStatus("partial_success"),
            )

    monkeypatch.setattr("rag.live.build_html_converter", HalfConverter)

    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, StubFetcher(site()), RELEVANT, registry)

    assert result.verdict.relevant is True  # the gate wanted it...
    assert result.persisted is False  # ...the conversion did not finish
    assert result.chunks  # still usable for this turn
    assert result.outlinks  # and the outlink graph survives for the loop
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0
    assert not registry.exists()


def test_a_parse_crash_costs_the_candidate_not_the_turn(
    web_client: QdrantClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """One encrypted or malformed PDF must not raise out of the ingest."""

    def exploding_converter(pipeline: str, **kwargs: Any) -> Any:
        raise RuntimeError("cannot decrypt")

    monkeypatch.setattr("rag.live.build_converter", exploding_converter)

    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, StubFetcher(pdf_site()), RELEVANT, registry, url=PDF_URL)

    assert result.persisted is False
    assert result.chunks == []
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0
    assert not registry.exists()


def test_an_unsupported_content_type_is_never_parsed_or_stored(
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """A student can paste the same extensionless download URL the crawler
    stumbles on; the content type is the second net on both paths."""
    pages = site()
    pages[URL] = page(URL, b"PK\x03\x04 fake xlsx", "application/octet-stream")
    registry = tmp_path / "registry.jsonl"

    result = ingest(web_client, StubFetcher(pages), RELEVANT, registry)

    assert result.persisted is False
    assert result.chunks == []
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0


def test_an_oversized_body_is_never_parsed_or_stored(
    web_client: QdrantClient,
    tmp_path: Path,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The download bound: a body over MAX_ATTACHMENT_BYTES counts as not
    retrieved, whatever its content type."""
    from rag.crawl import MAX_ATTACHMENT_BYTES

    pages = site()
    pages[URL] = page(URL, b"x" * (MAX_ATTACHMENT_BYTES + 1), "text/html")
    registry = tmp_path / "registry.jsonl"

    result = ingest(web_client, StubFetcher(pages), RELEVANT, registry)

    assert result.persisted is False
    assert result.chunks == []
    assert recorded_deletes == []
    assert web_client.count(WEB_COLLECTION).count == 0
    assert not registry.exists()


def test_a_page_that_now_parses_to_nothing_still_replaces_its_old_version(
    web_client: QdrantClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    recorded_deletes: list[tuple[list[tuple[str, str]], str]],
    stub_chunking: None,
) -> None:
    """The reason the scoped delete is called here and not left to
    `index_chunks`: with no chunks there are no pairs to scope it by, and the
    superseded version would survive as the answer."""
    monkeypatch.setattr("rag.live.chunk_document", lambda *args: [])
    index_chunks(
        web_client,
        [make_web_chunk("bb" * 32, "live", URL)],
        StubDense(),
        StubSparse(),
        WEB_COLLECTION,
    )

    registry = tmp_path / "registry.jsonl"
    result = ingest(web_client, StubFetcher(site()), RELEVANT, registry)

    assert result.persisted is True
    assert result.chunks == []
    assert recorded_deletes == [([(URL, "live")], WEB_COLLECTION)]
    assert web_client.count(WEB_COLLECTION).count == 0  # the stale version is gone
    assert read_registry(registry)[0].url == URL  # the fetch is still on the ledger


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        ("http://localhost:11434/v1", [["ollama", "stop", "qwen3:4b"]]),
        ("http://127.0.0.1:11434/v1", [["ollama", "stop", "qwen3:4b"]]),
        ("http://localhost:8000/v1", []),  # a local vLLM, not Ollama
        ("https://micc.example.org/v1", []),
    ],
)
def test_the_llm_is_only_unloaded_on_a_local_ollama_endpoint(
    base_url: str, expected: list[list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Switching the backend must stay a `.env` edit: any endpoint that is not
    the local Ollama server has no CLI to call and must be left alone."""
    calls: list[list[str]] = []
    kwargs: list[dict[str, Any]] = []

    def fake_run(command: Sequence[str], **options: Any) -> Any:
        calls.append(list(command))
        kwargs.append(options)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("subprocess.run", fake_run)
    maybe_unload_llm(base_url, "qwen3:4b")
    assert calls == expected
    assert all(option["check"] is False for option in kwargs)


def test_a_failed_unload_is_a_warning_not_a_stop(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """No ollama on PATH costs headroom, never the step."""

    def missing_binary(command: Sequence[str], **options: Any) -> Any:
        raise FileNotFoundError("ollama")

    monkeypatch.setattr("subprocess.run", missing_binary)
    with caplog.at_level("WARNING"):
        maybe_unload_llm("http://localhost:11434/v1", "qwen3:4b")
    assert any("ollama stop" in record.message for record in caplog.records)


def test_gate_measurement_scores_every_row_against_its_label(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The 20-row annotation set is the gate's exam; the report is per row plus
    one agreement count, and nothing is parsed or stored along the way."""
    labeled = tmp_path / "relevance-gate.jsonl"
    labeled.write_text(
        f'{{"url": "{URL}", "label": "relevant", "note": "DSU"}}\n'
        f'{{"url": "{URL}", "label": "irrelevant", "note": "counter-example"}}\n',
        encoding="utf-8",
    )

    agreed = run_gate_measurement(
        labeled,
        StubFetcher(site()),
        ScriptedCompleter([RELEVANT, RELEVANT]),
        throttle=Throttle(interval=0.0),
    )

    out = capsys.readouterr().out
    assert f"{URL} relevant -> relevant [campus service page]" in out
    assert f"{URL} irrelevant -> relevant [campus service page]" in out
    assert "agreement: 1/2" in out
    assert agreed == 1


def test_gate_measurement_fails_loudly_on_a_missing_annotation_set(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        run_gate_measurement(
            tmp_path / "absent.jsonl", StubFetcher(site()), StubCompleter(RELEVANT)
        )


def test_cli_ingests_a_url_and_unloads_the_llm_before_the_heavy_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    stub_chunking: None,
) -> None:
    unloaded: list[str] = []

    def stub_dense(model_name: str, device: str | None = None) -> StubDense:
        assert device == "cpu"  # live encoding stays off the GPU
        return StubDense()

    def stub_unload(base_url: str, model: str) -> None:
        unloaded.append(model)

    monkeypatch.setattr("rag.live.cached_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.live.build_sparse_encoder", StubSparse)
    monkeypatch.setattr("rag.live.HttpxFetcher", lambda: StubFetcher(site()))
    monkeypatch.setattr("rag.live.maybe_unload_llm", stub_unload)

    def stub_completer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0, seed: int | None = None
    ) -> StubCompleter:
        assert (temperature, seed) == (0.0, 0)  # the gate is pinned: greedy plus a fixed seed
        return StubCompleter(RELEVANT)

    monkeypatch.setattr("rag.live.build_completer", stub_completer)

    registry = tmp_path / "registry.jsonl"
    main(
        [
            URL,
            "--trigger",
            "g001",
            "--run-id",
            RUN_ID,
            "--qdrant-path",
            str(tmp_path / "qdrant"),
            "--registry",
            str(registry),
        ]
    )

    assert f"{RUN_ID}: persisted {URL}" in capsys.readouterr().out
    assert len(unloaded) == 1
    assert read_registry(registry)[0].ingest_run_id == RUN_ID


def test_rollback_cli_removes_one_run_and_reports_what_is_left(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    qdrant_path = tmp_path / "qdrant"
    client = open_client(qdrant_path)
    ensure_collection(client, StubDense().dimension(), WEB_COLLECTION)
    index_chunks(
        client,
        [
            make_web_chunk("aa" * 32, "live", URL).model_copy(update={"ingest_run_id": RUN_ID}),
            make_web_chunk("bb" * 32, "live", PDF_URL).model_copy(
                update={"ingest_run_id": "live-other"}
            ),
        ],
        StubDense(),
        StubSparse(),
        WEB_COLLECTION,
    )
    client.close()

    main(["--rollback", RUN_ID, "--qdrant-path", str(qdrant_path)])

    out = capsys.readouterr().out
    assert f"rolled back {RUN_ID}: 1 points removed, 1 left in {WEB_COLLECTION}" in out


def test_cli_takes_exactly_one_mode() -> None:
    """Three modes share one entry point; a url plus --rollback is a typo with
    an irreversible second half."""
    with pytest.raises(SystemExit):
        main([URL, "--rollback", RUN_ID])
    with pytest.raises(SystemExit):
        main([])


def test_cli_refuses_a_run_id_that_no_rollback_could_find() -> None:
    """`delete_by_run` only ever deletes live points, so a crawl-shaped run id
    would write chunks that no rollback command can reach."""
    with pytest.raises(SystemExit):
        main([URL, "--run-id", "crawl-20260822-143647"])


def test_importing_live_does_not_load_docling() -> None:
    """Live imports both parse modules at module level, and docling drags torch
    along: the converters are built behind `lru_cache` precisely so that the
    import costs nothing until a page is actually parsed."""
    import subprocess
    import sys

    base_dir = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        [sys.executable, "-c", "import rag.live, sys; print('docling' in sys.modules)"],
        cwd=base_dir,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"
