"""Query-time ingest: fetch one URL, gate it, and grow the shared knowledge base.

The only module allowed to write to the shared index at query time (the module
boundary rule, docs/architettura.md): `rag/agent.py` routes and reads, this is
where a page the student pasted — or the deepening loop picked — becomes
indexed chunks.

Two branches, and both of them must be able to answer the current turn
(the state machine in docs/fonte-web-unifi.md):

- the gate says relevant -> gate-then-persist: parse, chunk, replace exactly
  this URL's previous *live* version, upsert, and append one registry row
  naming the trigger and the run, so the whole run rolls back in one call
  (`delete_by_run`). The crawl snapshot version of the same URL is a different
  (url, ingest_source) pair and is never touched (ADR-1);
- the gate says no, or its reply does not validate -> ephemeral branch: parse
  and chunk exactly the same way, then return the chunks in memory and write
  nothing at all. A 4B gate misjudging a link a student pasted must cost the
  knowledge base, never the answer. A parse that crashes or stops at the
  document timeout lands in the same branch for the opposite reason: what came
  back is too incomplete to store, but still good enough to read out once.

Everything heavy here is pinned to the CPU because of the VRAM budget: three
GPU tenants (embedder, reranker, LLM) already peak at 7761 of 8188 MiB, so live
PDF parsing runs on CPU under a page cap, live dense encoding uses the CPU
encoder instance owned by `rag.index`, and the local LLM is unloaded between
the gate and the parse/encode work.

    uv run python -m rag.live https://www.dsu.toscana.it/borsa-di-studio --trigger g001
    uv run python -m rag.live --rollback live-20260823-120000
    uv run python -m rag.live --measure-gate
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict

from rag.chunk import (
    DEFAULT_MAX_TOKENS,
    DEFAULT_TOKENIZER,
    Chunk,
    build_chunker,
    build_tokenizer,
    chunk_document,
    detect_locale,
)
from rag.crawl import (
    DEFAULT_SCOPE,
    MAX_ATTACHMENT_BYTES,
    Fetcher,
    HttpxFetcher,
    Outlink,
    RegistryEntry,
    Response,
    RobotsCache,
    Throttle,
    append_registry,
    artifact_name,
    extract_links,
    is_pdf,
    rule_for,
    supported_content,
)
from rag.index import (
    DEFAULT_DENSE_MODEL,
    DEFAULT_QDRANT_DIR,
    WEB_COLLECTION,
    DenseEncoder,
    SparseEncoder,
    build_sparse_encoder,
    cached_dense_encoder,
    delete_by_run,
    delete_web_versions,
    ensure_collection,
    index_chunks,
    open_client,
)
from rag.llm import Completer, Message, build_completer, complete_json
from rag.parse import build_converter
from rag.probe import configure_cli_logging
from rag.webparse import (
    PRUNE_TAGS,
    build_html_converter,
    convert_html,
    html_lang,
    meta_for,
    prune_html,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from docling.document_converter import DocumentConverter
    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
    from qdrant_client import QdrantClient

logger = logging.getLogger(__name__)

# Live parsing budget. A campus decree can run to hundreds of pages; 40 is what
# a single answer can use. The page cap is a *range*, `page_range=(1, N)`,
# never `max_num_pages=N`: docling reads the latter as a policy limit on the
# whole document and rejects a longer one outright (ConversionStatus.FAILURE),
# which would lose exactly the long decrees this cap exists to make usable.
# The two timeouts split on a measurement (semantics owned by
# docs/fonte-web-unifi.md): the corpus's largest PDF (18.4 MB, capped at 40
# pages) takes 66-69s through the classic pipeline on CPU, so a parse held to
# the 60s step clock would come back PARTIAL_SUCCESS — readable this turn,
# never storable — for exactly the long documents worth fetching. The parse
# step therefore gets its own budget with headroom over that worst case, while
# the per-step wall clock the deepening loop enforces (Stage 8) stays at 60.
LIVE_MAX_PDF_PAGES = 40
STEP_TIMEOUT_SECONDS = 60
PDF_PARSE_TIMEOUT_SECONDS = 120

# How much page text the gate sees. Enough for a title, a lead paragraph and
# the first list; more would only slow a decision that is already binary.
GATE_SAMPLE_CHARS = 1500

GATE_FALLBACK_REASON = "gate: unparseable reply"

# Local Ollama, the only endpoint this module knows how to unload.
OLLAMA_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
OLLAMA_PORT = 11434

DEFAULT_REGISTRY = Path(__file__).resolve().parent.parent / "data" / "webcorpus" / "registry.jsonl"
DEFAULT_GATE_SET = Path("gold") / "relevance-gate.jsonl"

# Each criterion below answers a measured failure of the 4B gate against the
# frozen annotation set (gold/relevance-gate.jsonl), not a guess at what a
# model might get wrong: rejected TOLC calendars for naming other Tuscan
# universities, and accepted a commercial housing platform that advertises
# itself as the university's own service.
GATE_SYSTEM_PROMPT = """\
You decide whether a fetched web page is worth storing permanently in the \
knowledge base of a University of Florence student assistant, which answers \
questions about courses, enrolment, fees, DSU benefits, housing, exams, \
offices, deadlines and student services.

Judge the content, not the domain: a page on another site (DSU Toscana, CISIA, \
a course catalogue) is relevant when it answers such a question, and a page on \
unifi.it is not relevant when it carries no answer — a login form, an empty \
listing, an advert, a page about something else entirely.

Two rules decide the hard cases:
- Tuscany-wide student services run for public universities — DSU Toscana \
scholarships, housing and canteens, CISIA/TOLC admission tests and their exam \
calendars — serve University of Florence students too. They are relevant even \
off a unifi.it domain and even when the page also names Pisa, Siena or other \
universities.
- Commercial platforms and third-party services are not university content, \
however loudly the page claims to be official, affiliated or partnered. Ask who \
operates the page: an institution publishing its own information, or a business \
selling, listing or brokering something to students.

Reply with ONLY one JSON object, no prose:
{"relevant": true, "reason": "..."}"""


class RelevanceVerdict(BaseModel):
    """The gate's reply: keep this page in the shared knowledge base, or not."""

    model_config = ConfigDict(frozen=True)

    relevant: bool
    reason: str


class GateRow(BaseModel):
    """One line of gold/relevance-gate.jsonl (schema owned by gold/README.md).

    Deliberately not a `GoldQuestion`: the annotation set has no id, question or
    answer_ref, and handing it to `rag.gold` is a validation error by design.
    """

    model_config = ConfigDict(frozen=True)

    url: str
    label: Literal["relevant", "irrelevant"]
    note: str = ""


@dataclass(frozen=True)
class ParsedPage:
    """What one fetched page turned into before anything is written.

    `complete` is False whenever the conversion did not finish cleanly — a
    crash, or docling stopping at the document timeout and handing back a
    truncated document. Such a page may answer this turn but must never be
    stored: its chunks would be indexed under the *whole* document's
    content_hash, so the incremental check would consider the page unchanged
    and no later fetch would ever repair it.
    """

    chunks: list[Chunk]
    outlinks: list[Outlink]
    complete: bool


@dataclass(frozen=True)
class LiveResult:
    """One live fetch: whether it grew the shared index, the chunks this turn
    can answer from either way, the page's outlinks (the deepening loop's
    candidates, so Stage 8 never refetches to get them) and the gate's verdict.

    `persisted` can be False while `verdict.relevant` is True: the gate wanted
    the page, the parse did not finish.
    """

    persisted: bool
    chunks: list[Chunk]
    outlinks: list[Outlink]
    verdict: RelevanceVerdict


class _TextParser(HTMLParser):
    """Visible text on stdlib only. The gate runs *before* parsing, so neither
    bs4 nor Docling is loaded yet, and neither may be pulled in to produce a
    1500-character sample. The skipped tags are the same list the parse step
    prunes, so the gate judges what the index would keep."""

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in PRUNE_TAGS:
            self._depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in PRUNE_TAGS and self._depth:
            self._depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._depth:
            self.parts.append(data)


def pdf_text_sniff(body: bytes) -> str:
    """First page of a PDF as raw text, for the gate and nothing else.

    This is a peek, not a parse: pypdf reads the existing text layer of one
    page, while Docling still owns real parsing (layout, tables, OCR) on the
    other side of the gate. The distinction is the whole point — judging a
    modulo on its filename alone was a measured gate failure, and paying the
    classic pipeline for a page the gate may reject would be worse. Anything
    pypdf cannot read (encrypted, scanned, malformed) degrades to no sample,
    exactly as before.
    """
    from io import BytesIO

    from pypdf import PdfReader

    try:
        reader = PdfReader(BytesIO(body))
        return reader.pages[0].extract_text() or ""
    except Exception:  # encrypted, image-only or truncated: no text layer to read
        logger.debug("no readable text layer on the first page")
        return ""


def gate_sample(url: str, response: Response) -> str:
    """What the gate judges, extracted without parsing the document.

    HTML degrades to visible text, a PDF to the text layer of its first page:
    enough for a title and an opening paragraph, which is what separates a
    modulo from a decree. Both are capped at the same length, and both may come
    back empty — a script-rendered page or a scanned attachment leaves the gate
    with the URL alone.
    """
    if is_pdf(url, response.content_type):
        sample = " ".join(pdf_text_sniff(response.body).split())[:GATE_SAMPLE_CHARS]
    else:
        parser = _TextParser()
        parser.feed(response.body.decode("utf-8", errors="replace"))
        sample = " ".join("".join(parser.parts).split())[:GATE_SAMPLE_CHARS]
    if not sample:
        # Say so, or a whole class of misjudgements looks like the model's fault.
        logger.debug("%s: no readable text, the gate sees the URL only", url)
    return sample


def judge_relevance(
    completer: Completer,
    url: str,
    content_type: str,
    text_sample: str,
    trigger: str | None = None,
) -> RelevanceVerdict:
    """Binary keep-or-drop for one page; an unusable reply is a `False`.

    That direction is the frozen contract: a reply that fails validation must
    never grow the shared knowledge base, and it costs nothing this turn — the
    ephemeral branch hands the same chunks back either way.
    """
    messages: list[Message] = [
        {"role": "system", "content": GATE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"url: {url}\n"
                f"content-type: {content_type}\n"
                f"fetched for: {trigger or 'a link the student pasted'}\n"
                f"page text: {text_sample or '(no text: judge from the URL and filename alone)'}"
            ),
        },
    ]
    verdict = complete_json(completer, messages, RelevanceVerdict)
    return verdict or RelevanceVerdict(relevant=False, reason=GATE_FALLBACK_REASON)


def maybe_unload_llm(base_url: str, model: str) -> None:
    """Free the LLM's VRAM before the parse/encode work — local Ollama only.

    Any other endpoint (the MICC vLLM server in M3) is a no-op: `rag/` stays
    decoupled from the Ollama CLI, and switching backends stays a `.env` edit
    (docs/architettura.md). A failed unload is a warning, never a stop: the
    worst case is the step running with less headroom than planned.
    """
    parts = urlsplit(base_url)
    if parts.hostname not in OLLAMA_HOSTS or parts.port != OLLAMA_PORT:
        return
    try:
        reply = subprocess.run(  # noqa: S603 - fixed argv, no shell, no user input
            ["ollama", "stop", model],  # noqa: S607 - `ollama` comes off PATH by design
            check=False,
            capture_output=True,
        )
    except OSError as error:  # no ollama binary on PATH, or it could not start
        logger.warning("ollama stop %s failed (%s), continuing", model, error)
        return
    if reply.returncode != 0:
        logger.warning("ollama stop %s: exit %d, continuing", model, reply.returncode)


# Everything below is loaded once per process and reused. Docling caches its
# initialized pipelines on the converter *instance*, so a converter built per
# fetch would reload the layout and table models inside every step budget; the
# chunker's tokenizer is the same story. The throttle and the robots cache are
# shared for a different reason: a fresh `Throttle` starts with `_last = 0.0`,
# so a per-call instance never waits and the 1 req/s promise would hold only
# within a single call, while a per-call `RobotsCache` refetches robots.txt for
# every page. Stage 8's loop injects this same pair rather than making its own.


@lru_cache(maxsize=1)
def live_chunker() -> HybridChunker:
    return build_chunker(build_tokenizer(DEFAULT_TOKENIZER, DEFAULT_MAX_TOKENS))


@lru_cache(maxsize=1)
def live_pdf_converter() -> DocumentConverter:
    return build_converter("classic", device="cpu", document_timeout=PDF_PARSE_TIMEOUT_SECONDS)


@lru_cache(maxsize=1)
def live_html_converter() -> DocumentConverter:
    return build_html_converter()


@lru_cache(maxsize=1)
def shared_throttle() -> Throttle:
    return Throttle()


@lru_cache(maxsize=1)
def shared_robots(fetcher: Fetcher) -> RobotsCache:
    return RobotsCache(fetcher)


def fetch_page(
    url: str, fetcher: Fetcher, robots: RobotsCache, throttle: Throttle
) -> Response | None:
    """Robots check, then one throttled fetch — politeness is not conditional
    on the page turning out to be useful.

    None covers every reason the bytes are not ours to use: disallowed, dead
    URL, non-200, a body over the attachment cap (the download itself has to be
    bounded, not just the parsing), or a content type this pipeline cannot read.
    Each is logged with its own message; to the callers they are one outcome,
    nothing to gate and nothing to store.
    """
    if not robots.allowed(url):
        logger.warning("%s: disallowed by robots.txt", url)
        return None
    throttle.wait()
    try:
        response = fetcher.get(url)
    except Exception:  # one dead URL must not end the student's turn
        logger.warning("%s: fetch failed", url)
        return None
    if response.status != 200:
        logger.info("%s: HTTP %d", url, response.status)
        return None
    if len(response.body) > MAX_ATTACHMENT_BYTES:
        logger.warning("%s: body over %d bytes", url, MAX_ATTACHMENT_BYTES)
        return None
    if not supported_content(url, response.content_type):
        logger.info("%s: unsupported content type %s", url, response.content_type)
        return None
    return response


def parse_page(url: str, response: Response, entry: RegistryEntry) -> ParsedPage:
    """Fetched bytes -> payload-bearing chunks, down the same two paths the
    crawl snapshot uses: bs4 pre-prune plus Docling's declarative HTML backend
    for pages, the classic pipeline for PDF attachments.

    The PDF side is where the VRAM budget bites, and the caps land in different
    places: `device` and `document_timeout` are pipeline options, the page cap
    is a `convert()` argument. A conversion that stops at the timeout comes back
    as PARTIAL_SUCCESS with a truncated document and no exception — that is not
    a page to store, so it is reported as incomplete. A conversion that raises
    is the same answer with a warning: one encrypted or malformed PDF must cost
    the candidate, never the turn. Both branches judge completeness off the same
    `ConversionStatus`: a half-converted page is no more storable than a
    truncated attachment, and guessing `True` for HTML would freeze it.

    Live keeps no snapshot file, so the artifact name is the one a crawl of the
    same URL would use — same identity, no bytes on disk.
    """
    from docling.datamodel.base_models import ConversionStatus

    pdf = is_pdf(url, response.content_type)
    artifact = Path(artifact_name(url, ".pdf" if pdf else ".html"))
    outlinks: list[Outlink] = []
    try:
        if pdf:
            from io import BytesIO

            from docling.datamodel.base_models import DocumentStream

            stream = DocumentStream(name=artifact.name, stream=BytesIO(response.body))
            result = live_pdf_converter().convert(stream, page_range=(1, LIVE_MAX_PDF_PAGES))
            meta = meta_for(entry, artifact=artifact, variant="classic", lang=None)
        else:
            raw = response.body.decode("utf-8", errors="replace")
            outlinks = [Outlink(url=link, text=text) for link, text in extract_links(url, raw)]
            result = convert_html(prune_html(raw), artifact.stem, live_html_converter())
            meta = meta_for(entry, artifact=artifact, variant="html", lang=html_lang(raw))
        document = result.document
        # Anything short of a clean success leaves a partial document.
        complete = result.status == ConversionStatus.SUCCESS
        if not complete:
            logger.warning("%s: conversion %s, not storable", url, result.status)
        locale = meta.lang or detect_locale("\n".join(item.text for item in document.texts))
        chunks = chunk_document(document, live_chunker(), meta, locale)
    except Exception:  # a broken document is one lost candidate, not a lost turn
        logger.warning("%s: parse failed", url)
        return ParsedPage(chunks=[], outlinks=outlinks, complete=False)
    return ParsedPage(chunks=chunks, outlinks=outlinks, complete=complete)


def fetch_and_ingest(
    url: str,
    *,
    fetcher: Fetcher,
    completer: Completer,
    client: QdrantClient,
    dense: DenseEncoder,
    sparse: SparseEncoder,
    run_id: str,
    trigger: str | None = None,
    referrer_url: str | None = None,
    registry_path: Path = DEFAULT_REGISTRY,
    collection: str = WEB_COLLECTION,
    robots: RobotsCache | None = None,
    throttle: Throttle | None = None,
    unload_llm: Callable[[], None] | None = None,
) -> LiveResult:
    """Fetch one URL, gate it, and persist it only if the gate says so.

    Everything the network and the models touch is injected, so the whole
    branching contract is testable offline. `unload_llm` is called once the
    gate has answered and before any parsing or encoding starts — the caller
    decides what that means (see `maybe_unload_llm`), which keeps this module
    free of both the endpoint configuration and the Ollama CLI.
    """
    robots = robots or shared_robots(fetcher)
    throttle = throttle or shared_throttle()

    response = fetch_page(url, fetcher, robots, throttle)
    if response is None:
        return LiveResult(
            persisted=False,
            chunks=[],
            outlinks=[],
            verdict=RelevanceVerdict(relevant=False, reason="fetch: page not retrieved"),
        )

    verdict = judge_relevance(
        completer, url, response.content_type, gate_sample(url, response), trigger
    )
    # The gate is this step's last LLM work; the parse and the encode below are
    # the heavy CPU/RAM stretch that wants its VRAM back.
    if unload_llm is not None:
        unload_llm()

    # Section labels come from the same scope table the crawler uses; a live
    # URL outside it has none — the autogrow range is not domain-locked.
    rule = rule_for(url, DEFAULT_SCOPE)
    entry = RegistryEntry(
        url=url,
        content_hash=hashlib.sha256(response.body).hexdigest(),
        fetch_date=datetime.now(UTC).date().isoformat(),
        ingest_run_id=run_id,
        ingest_source="live",
        trigger=trigger,
        referrer_url=referrer_url,
        section=rule.section if rule else None,
    )
    parsed = parse_page(url, response, entry)

    if not verdict.relevant or not parsed.complete:
        # Ephemeral: usable for this turn, invisible to every later one — the
        # gate refused it, or the parse did not finish and storing a truncated
        # page under the full document's hash would make it permanent.
        logger.info("%s: not persisted - %s", url, verdict.reason)
        return LiveResult(
            persisted=False, chunks=parsed.chunks, outlinks=parsed.outlinks, verdict=verdict
        )

    # Scoped to (url, "live"): the crawl snapshot version of this page survives
    # untouched. `index_chunks` scopes the same delete, but only for the pairs
    # its chunks carry — doing it here also replaces a page that now parses to
    # nothing. The third argument is not optional in spirit: its default is the
    # slides collection, and omitting it would delete from the wrong index.
    delete_web_versions(client, [(url, "live")], collection)
    if parsed.chunks:
        index_chunks(client, parsed.chunks, dense, sparse, collection)
    # The outlinks ride into the ledger the way the crawler writes them: the
    # deepening loop reads its candidates from the registry's outlink graph.
    append_registry(registry_path, entry.model_copy(update={"outlinks": parsed.outlinks}))
    logger.info("%s: %d chunks persisted under %s", url, len(parsed.chunks), run_id)
    return LiveResult(
        persisted=True, chunks=parsed.chunks, outlinks=parsed.outlinks, verdict=verdict
    )


def load_gate_rows(path: Path) -> list[GateRow]:
    if not path.is_file():
        raise SystemExit(f"annotation set not found: {path}")
    return [
        GateRow.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def run_gate_measurement(
    labeled_path: Path,
    fetcher: Fetcher,
    completer: Completer,
    throttle: Throttle | None = None,
    robots: RobotsCache | None = None,
) -> int:
    """Score the gate against the frozen annotation set, one row at a time.

    This is the Stage 7 measurement: at least 18 of 20 keeps the LLM gate,
    below that the design degrades to the ScopeRule table — a finding to record
    in the diario, never a silent fix. Nothing is parsed or stored here; a row
    whose page cannot be fetched still scores, with the reason printed.
    """
    rows = load_gate_rows(labeled_path)
    robots = robots or RobotsCache(fetcher)
    throttle = throttle or Throttle()

    agreed = 0
    for row in rows:
        response = fetch_page(row.url, fetcher, robots, throttle)
        if response is None:
            verdict = RelevanceVerdict(relevant=False, reason="fetch: page not retrieved")
        else:
            verdict = judge_relevance(
                completer, row.url, response.content_type, gate_sample(row.url, response)
            )
        label = "relevant" if verdict.relevant else "irrelevant"
        agreed += label == row.label
        print(f"{row.url} {row.label} -> {label} [{verdict.reason}]")
    print(f"agreement: {agreed}/{len(rows)}")
    return agreed


def main(argv: list[str] | None = None) -> None:
    from config.env import env

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", help="the page to fetch, gate and ingest")
    parser.add_argument(
        "--trigger",
        metavar="question_id",
        default=None,
        help="the question this fetch answers, recorded in the registry row",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="group several fetches into one rollback unit; default: live-<UTC timestamp>",
    )
    parser.add_argument("--referrer", default=None, help="the page this URL was picked from")
    parser.add_argument(
        "--rollback",
        metavar="run_id",
        default=None,
        help="delete every live point written under this run",
    )
    parser.add_argument(
        "--measure-gate",
        nargs="?",
        metavar="path",
        type=Path,
        const=DEFAULT_GATE_SET,
        default=None,
        help=f"score the relevance gate against an annotation set (default: {DEFAULT_GATE_SET})",
    )
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    args = parser.parse_args(argv)

    modes = [
        name
        for name, value in (
            ("a url", args.url),
            ("--rollback", args.rollback),
            ("--measure-gate", args.measure_gate),
        )
        if value is not None
    ]
    if len(modes) != 1:
        parser.error("give exactly one of: a url, --rollback <run_id>, --measure-gate [path]")
    if args.run_id is not None and not args.run_id.startswith("live-"):
        # Run ids are the rollback unit and `delete_by_run` only ever deletes
        # live points: a crawl-shaped id here would write points no rollback
        # command could find again.
        parser.error("--run-id must start with 'live-'")

    configure_cli_logging()

    if args.rollback is not None:
        client = open_client(args.qdrant_path)
        before = client.count(WEB_COLLECTION).count
        delete_by_run(client, args.rollback)
        after = client.count(WEB_COLLECTION).count
        client.close()
        print(
            f"rolled back {args.rollback}: {before - after} points removed, "
            f"{after} left in {WEB_COLLECTION}"
        )
        return

    # Fixed seed: the run-twice-identical gate must not rest on greedy decoding
    # alone; recorded in diario at Stage 9.
    completer = build_completer(
        env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0, seed=0
    )
    fetcher = HttpxFetcher()

    if args.measure_gate is not None:
        run_gate_measurement(args.measure_gate, fetcher, completer)
        return

    run_id = args.run_id or "live-" + datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    # CPU encoder, from the shared cache: the GPU is already hosting the
    # reranker, and this first load is amortized over the process rather than
    # charged to one step's budget.
    dense = cached_dense_encoder(args.dense_model, device="cpu")
    sparse = build_sparse_encoder()
    client = open_client(args.qdrant_path)
    ensure_collection(client, dense.dimension(), WEB_COLLECTION)
    result = fetch_and_ingest(
        args.url,
        fetcher=fetcher,
        completer=completer,
        client=client,
        dense=dense,
        sparse=sparse,
        run_id=run_id,
        trigger=args.trigger,
        referrer_url=args.referrer,
        registry_path=args.registry,
        unload_llm=lambda: maybe_unload_llm(env.llm_base_url, env.llm_model),
    )
    client.close()
    print(
        f"{run_id}: {'persisted' if result.persisted else 'ephemeral'} "
        f"{args.url} ({len(result.chunks)} chunks) [{result.verdict.reason}]"
    )


if __name__ == "__main__":
    main()
