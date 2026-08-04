"""The chunk payload is the index contract: every field must be present and right
at chunking time because none of them can be backfilled once indexed. All tests
run offline — a word-counting tokenizer stub and a programmatically built
DoclingDocument stand in for transformers and a real parse."""

import subprocess
import sys
from pathlib import Path

from rag.chunk import (
    Chunk,
    chunk_document,
    collect_documents,
    detect_locale,
    furniture_headings,
    furniture_threshold,
    meta_path_of,
)
from rag.parse import ParsedMeta

BASE_DIR = Path(__file__).resolve().parent.parent

FURNITURE = "HTML &amp; CSS"


def make_meta() -> ParsedMeta:
    return ParsedMeta(
        source_file="deck.pdf",
        source_path="/corpus/PPM/deck.pdf",
        source_sha256="ab" * 32,
        parse_variant="classic",
        docling_version="0.0.0",
        course="PPM",
        seconds=1.5,
        parsed_at="2026-08-03T00:00:00+00:00",
    )


def build_document():  # DoclingDocument return type stays a lazy import
    """Five pages of repeated furniture heading, plus one genuine two-page section
    whose body carries a U+FB01 ligature."""
    from docling_core.types.doc.base import BoundingBox
    from docling_core.types.doc.common.reference import ProvenanceItem
    from docling_core.types.doc.document import DoclingDocument
    from docling_core.types.doc.labels import DocItemLabel

    def prov(page: int, length: int) -> ProvenanceItem:
        return ProvenanceItem(
            page_no=page, bbox=BoundingBox(l=0, t=0, r=100, b=100), charspan=(0, length)
        )

    document = DoclingDocument(name="deck")
    for page in range(1, 6):
        heading = document.add_heading(text=FURNITURE, prov=prov(page, len(FURNITURE)))
        document.add_text(
            label=DocItemLabel.TEXT,
            text=f"Filler body for page {page}.",
            prov=prov(page, 25),
            parent=heading,
        )
    section = document.add_heading(text="Merge sort", prov=prov(1, 10))
    document.add_text(
        label=DocItemLabel.TEXT,
        text="Complexity analysis of the unﬁnished merge sort implementation.",
        prov=prov(1, 62),
        parent=section,
    )
    document.add_text(
        label=DocItemLabel.TEXT,
        text="The second page continues the merge sort analysis with examples.",
        prov=prov(2, 63),
        parent=section,
    )
    return document


def make_chunks() -> list[Chunk]:
    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
    from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer

    class WordTokenizer(BaseTokenizer):
        def count_tokens(self, text: str) -> int:
            return len(text.split())

        def get_max_tokens(self) -> int:
            return 64

        def get_tokenizer(self) -> object:
            return self

    chunker = HybridChunker(tokenizer=WordTokenizer())
    return chunk_document(build_document(), chunker, make_meta(), "en")


def merge_sort_chunk(chunks: list[Chunk]) -> Chunk:
    (found,) = [c for c in chunks if "merge sort" in c.text]
    return found


def test_every_payload_field_is_populated() -> None:
    chunks = make_chunks()
    assert chunks
    for chunk in chunks:
        assert chunk.text
        assert chunk.embed_text
        assert chunk.locale == "en"
        assert chunk.course == "PPM"
        assert chunk.source_file == "deck.pdf"
        assert chunk.page >= 1
        assert chunk.pages
        assert chunk.parse_variant == "classic"
        assert chunk.docling_version == "0.0.0"
        assert chunk.source_sha256 == "ab" * 32


def test_furniture_heading_is_dropped_but_real_section_survives() -> None:
    """A heading repeated on every page is a page header; keeping it would prefix
    every chunk's embed text with the same string and degrade dense retrieval."""
    chunks = make_chunks()
    assert all(FURNITURE not in chunk.heading_path for chunk in chunks)
    assert all(FURNITURE not in chunk.embed_text for chunk in chunks)
    section = merge_sort_chunk(chunks)
    assert section.heading_path == ["Merge sort"]
    assert "Merge sort" in section.embed_text


def test_citation_page_is_the_first_of_the_pages_spanned() -> None:
    """A chunk merged across a slide boundary still cites where it starts, while
    `pages` keeps the full truth for highlighting and evaluation."""
    section = merge_sort_chunk(make_chunks())
    assert section.pages == [1, 2]
    assert section.page == 1


def test_ligatures_are_folded_in_both_text_and_embed_text() -> None:
    section = merge_sort_chunk(make_chunks())
    assert "unﬁnished" not in section.text
    assert "unfinished" in section.text
    assert "unfinished" in section.embed_text


def test_chunk_ids_are_deterministic_across_reruns() -> None:
    """Re-indexing the same corpus snapshot + parse configuration must overwrite,
    not duplicate."""
    first = [c.chunk_id for c in make_chunks()]
    second = [c.chunk_id for c in make_chunks()]
    assert first == second
    assert first[0] == ("ab" * 32)[:16] + ":classic:0000"
    assert all(cid.startswith(("ab" * 32)[:16] + ":classic:") for cid in first)


def test_chunks_survive_a_jsonl_round_trip() -> None:
    for chunk in make_chunks():
        assert Chunk.model_validate_json(chunk.model_dump_json()) == chunk


def test_furniture_detection_is_threshold_gated() -> None:
    document = build_document()
    assert furniture_headings(document) == {FURNITURE}


def test_furniture_threshold_floors_at_five_pages() -> None:
    assert furniture_threshold(3) == 5
    assert furniture_threshold(25) == 5
    assert furniture_threshold(32) == 7
    assert furniture_threshold(100) == 20


def test_locale_heuristic_separates_the_corpus_languages() -> None:
    italian = (
        "Il sistema di gestione della base di dati non è una scelta che si fa "
        "per caso: anche le query più semplici passano per il modello."
    )
    english = (
        "The database management system is not a choice that you make at random: "
        "even the simplest queries go through the model."
    )
    assert detect_locale(italian) == "it"
    assert detect_locale(english) == "en"
    assert detect_locale("") == "en"


def test_meta_sidecars_are_paired_and_excluded_from_collection(tmp_path: Path) -> None:
    doc = tmp_path / "deck.classic.json"
    meta = tmp_path / "deck.classic.meta.json"
    doc.touch()
    meta.touch()
    assert meta_path_of(doc) == meta
    assert list(collect_documents(tmp_path)) == [doc]
    assert list(collect_documents(doc)) == [doc]


def test_stray_json_without_sidecar_is_skipped_in_directory_scans(tmp_path: Path) -> None:
    """Other tools have dropped state files under the parsed dir; a lone .json is
    not one of our artifacts and must not fail the corpus run. An explicitly
    named file still goes through, so a missing sidecar surfaces as an error."""
    doc = tmp_path / "deck.classic.json"
    (tmp_path / "deck.classic.meta.json").touch()
    doc.touch()
    stray = tmp_path / ".omc" / "state"
    stray.mkdir(parents=True)
    (stray / "pre-tool-advisory-throttle.json").touch()
    assert list(collect_documents(tmp_path)) == [doc]
    assert list(collect_documents(stray / "pre-tool-advisory-throttle.json")) == [
        stray / "pre-tool-advisory-throttle.json"
    ]


def test_importing_chunk_loads_neither_docling_nor_transformers() -> None:
    """The contract model and the heuristics must stay importable without paying
    for torch or a tokenizer download. Exact key membership, so `docling_core`
    cannot false-positive a substring check."""
    code = "import rag.chunk, sys; print('docling' in sys.modules, 'transformers' in sys.modules)"
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False False"
