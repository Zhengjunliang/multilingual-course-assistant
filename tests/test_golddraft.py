"""The drafting tool's pure logic must hold without any LLM: page regrouping,
stratified sampling, and the autogrow candidate pool (uncrawled, in-scope,
office-free) — the LLM half is human-gated and coverage-omitted."""

from pathlib import Path

from test_index import make_chunk

from rag.crawl import Outlink, RegistryEntry
from rag.golddraft import (
    PageSample,
    load_pages,
    pick_autogrow,
    stratified_sample,
    uncrawled_candidates,
)

PAGE_URL = "https://www.unifi.it/it/studia-con-noi/tasse"


def write_chunks(path: Path) -> None:
    rows = [
        make_chunk(0, "Le tasse universitarie si pagano online. " * 12).model_copy(
            update={"kind": "web", "url": PAGE_URL, "section": "servizi"}
        ),
        make_chunk(1, "Seconda rata entro dicembre. " * 12).model_copy(
            update={"kind": "web", "url": PAGE_URL, "section": "servizi"}
        ),
        make_chunk(2, "thin").model_copy(
            update={"kind": "web", "url": "https://www.unifi.it/it/x", "section": "servizi"}
        ),
        make_chunk(3, "A slides chunk never becomes a campus question."),
    ]
    path.write_text("".join(row.model_dump_json() + "\n" for row in rows), encoding="utf-8")


def test_load_pages_regroups_web_chunks_per_url(tmp_path: Path) -> None:
    write_chunks(tmp_path / "chunks.jsonl")
    pages = load_pages(tmp_path)
    assert {page.url for page in pages} == {PAGE_URL, "https://www.unifi.it/it/x"}
    joined = next(page for page in pages if page.url == PAGE_URL)
    assert "tasse" in joined.text
    assert "dicembre" in joined.text  # both chunks of the page, joined


def test_stratified_sample_respects_quota_and_skips_thin_pages(tmp_path: Path) -> None:
    write_chunks(tmp_path / "chunks.jsonl")
    pages = load_pages(tmp_path)
    picked = stratified_sample(pages, {"servizi": 5}, seed=1)
    assert [page.url for page in picked] == [PAGE_URL]  # thin page filtered out


def test_stratified_sample_is_deterministic() -> None:
    pages = [
        PageSample(url=f"https://x.example/{i}", section="servizi", text="x" * 400)
        for i in range(10)
    ]
    assert stratified_sample(pages, {"servizi": 3}, seed=7) == stratified_sample(
        pages, {"servizi": 3}, seed=7
    )


def make_entry(outlinks: list[Outlink]) -> RegistryEntry:
    return RegistryEntry(
        url="https://ingegneria.unifi.it/vp-185-per-laurearsi.html",
        content_hash="ab" * 32,
        fetch_date="2026-08-22",
        ingest_run_id="crawl-x",
        section="ingegneria",
        outlinks=outlinks,
    )


def test_uncrawled_candidates_are_unfetched_in_scope_and_office_free() -> None:
    entry = make_entry(
        [
            Outlink(
                url="https://ingegneria.unifi.it/upload/modulo_inizio_tesi.pdf",
                text="Modulo inizio tesi (laurea triennale)",
            ),
            Outlink(
                url="https://ingegneria.unifi.it/vp-185-per-laurearsi.html",
                text="Per laurearsi: scadenze e moduli",
            ),
            Outlink(
                url="https://ingegneria.unifi.it/upload/lista.xlsx",
                text="Lista accordi Erasmus completa",
            ),
            Outlink(url="https://elsewhere.example.org/out.html", text="Fuori scope, mai"),
            Outlink(url="https://ingegneria.unifi.it/vp-1-x.html", text="short"),
            Outlink(
                url="https://www.unifi.it/it/studia-con-noi/cercachi-per-15781.html",
                text="Referente del corso di laurea",
            ),
            Outlink(
                url="https://ingegneria.unifi.it/stat/awstats.ingegneria.alldomains.html",
                text="Statistiche complete del dominio",
            ),
        ]
    )
    candidates = uncrawled_candidates([entry])
    assert candidates == [
        (
            "https://ingegneria.unifi.it/upload/modulo_inizio_tesi.pdf",
            "Modulo inizio tesi (laurea triennale)",
        )
    ]


def test_pick_autogrow_guarantees_pdf_presence() -> None:
    candidates = [
        (f"https://ingegneria.unifi.it/vp-{i}-a.html", "Pagina con ancora") for i in range(9)
    ]
    candidates += [
        ("https://ingegneria.unifi.it/upload/m1.pdf", "Modulo uno"),
        ("https://ingegneria.unifi.it/upload/m2.pdf", "Modulo due"),
        ("https://ingegneria.unifi.it/upload/m3.pdf", "Modulo tre"),
    ]
    picked = pick_autogrow(candidates, seed=3)
    assert len(picked) == 8
    assert sum(url.lower().endswith(".pdf") for url, _ in picked) >= 2
