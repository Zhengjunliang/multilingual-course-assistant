"""Normalisation has to hold, or lexical retrieval silently misses matches; the CLI
flag rules and variant names are pure logic guarding user-facing behaviour."""

import subprocess
import sys
import unicodedata
from pathlib import Path

import pytest

from rag.parse import (
    ParsedMeta,
    build_converter,
    course_of,
    main,
    normalize_text,
    persist,
    variant_of,
)
from rag.probe import ParsePlan

BASE_DIR = Path(__file__).resolve().parent.parent


def test_parsed_meta_validates_pre_web_sidecar() -> None:
    """Sidecars already on disk predate the web fields and must load unchanged:
    kind=slides, every web field at its None default."""
    meta = ParsedMeta.model_validate(
        {
            "source_file": "deck.pdf",
            "source_path": "/corpus/PPM/deck.pdf",
            "source_sha256": "ab" * 32,
            "parse_variant": "classic",
            "docling_version": "0.0.0",
            "course": "PPM",
            "seconds": 1.5,
            "parsed_at": "2026-08-03T00:00:00+00:00",
        }
    )
    assert meta.kind == "slides"
    assert meta.lang is None
    assert meta.url is None
    assert meta.ingest_source is None


COMPOSED = "perché è più"


def make_meta(**overrides: object) -> ParsedMeta:
    fields: dict[str, object] = {
        "source_file": "deck.pdf",
        "source_path": "/corpus/PPM/deck.pdf",
        "source_sha256": "ab" * 32,
        "parse_variant": "classic",
        "docling_version": "0.0.0",
        "course": "PPM",
        "seconds": 1.5,
        "parsed_at": "2026-08-03T00:00:00+00:00",
    }
    fields.update(overrides)
    return ParsedMeta.model_validate(fields)


def test_ligatures_fold_to_plain_letters() -> None:
    """The corpus contains U+FB01 in `micc.uniﬁ.it`; a query for `unifi` must match."""
    assert normalize_text("micc.uniﬁ.it") == "micc.unifi.it"


def test_decomposed_accents_are_composed() -> None:
    """PDF extraction can emit `e` + combining acute, which tokenises differently."""
    decomposed = unicodedata.normalize("NFD", COMPOSED)
    assert decomposed != COMPOSED, "fixture is not actually decomposed"
    assert normalize_text(decomposed) == COMPOSED


def test_already_normal_text_is_untouched() -> None:
    assert normalize_text("Digital images are sampled as a grid of pixels.") == (
        "Digital images are sampled as a grid of pixels."
    )


def test_variant_names_encode_the_enabled_enrichments() -> None:
    """Output files are keyed by variant; two runs over the same deck must stay
    comparable on disk."""
    cases = {
        (False, False): "classic",
        (True, False): "classic-ocr",
        (False, True): "classic-formula",
        (True, True): "classic-ocr-formula",
    }
    for (ocr, formula), expected in cases.items():
        plan = ParsePlan(pipeline="classic", ocr=ocr, formula=formula, reason="manual")
        assert variant_of(plan) == expected


def test_manual_flags_are_rejected_under_auto_profile() -> None:
    """Silently ignoring --ocr under --profile auto would parse with a configuration
    the user did not ask for; argparse must refuse before any file is touched."""
    with pytest.raises(SystemExit):
        main(["missing.pdf", "--ocr"])


def test_classic_only_flags_are_rejected_on_the_vlm_pipeline() -> None:
    with pytest.raises(SystemExit):
        main(["missing.pdf", "--profile", "manual", "--pipeline", "vlm", "--ocr"])


def test_persist_writes_document_and_sidecar_as_a_pair(tmp_path: Path) -> None:
    """Chunking pairs the two files back up from a directory listing alone, so they
    must share the `<stem>.<variant>` key — and no other artifact may appear."""
    # docling_core is import-cheap (pure pydantic) but stays function-local to
    # mirror the module's own lazy-import discipline.
    from docling_core.types.doc.base import BoundingBox
    from docling_core.types.doc.common.reference import ProvenanceItem
    from docling_core.types.doc.document import DoclingDocument

    document = DoclingDocument(name="deck")
    prov = ProvenanceItem(page_no=1, bbox=BoundingBox(l=0, t=0, r=100, b=100), charspan=(0, 5))
    document.add_heading(text="Intro", prov=prov)
    meta = make_meta(parse_variant="classic-ocr")

    doc_path, meta_path = persist(document, meta, tmp_path)

    assert doc_path == tmp_path / "deck.classic-ocr.json"
    assert meta_path == tmp_path / "deck.classic-ocr.meta.json"
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "deck.classic-ocr.json",
        "deck.classic-ocr.meta.json",
    ]

    reloaded = DoclingDocument.load_from_json(doc_path)
    assert [item.text for item in reloaded.texts] == ["Intro"]
    assert ParsedMeta.model_validate_json(meta_path.read_text(encoding="utf-8")) == meta


def test_course_defaults_to_the_containing_directory(tmp_path: Path) -> None:
    corpus = tmp_path / "PPM"
    corpus.mkdir()
    deck = corpus / "deck.pdf"
    deck.touch()
    assert course_of(corpus) == "PPM"
    assert course_of(deck) == "PPM"


def recorded_pdf_options(monkeypatch: pytest.MonkeyPatch, **kwargs: object) -> object:
    """Build a classic converter against a recorder: the real one would load the
    layout models, and the device/timeout are pipeline options anyway."""
    from docling.datamodel.base_models import InputFormat

    captured: dict[InputFormat, object] = {}

    class RecordingConverter:
        def __init__(self, format_options: dict[InputFormat, object]) -> None:
            captured.update(format_options)

    monkeypatch.setattr("docling.document_converter.DocumentConverter", RecordingConverter)
    build_converter("classic", **kwargs)  # pyright: ignore[reportArgumentType] - forwarded kwargs
    return captured[InputFormat.PDF].pipeline_options  # pyright: ignore[reportAttributeAccessIssue]


def test_build_converter_leaves_docling_own_accelerator_default_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`device=None` must mean "docling decides", which is not the same as
    passing its "auto" sentinel: `AcceleratorOptions` is a BaseSettings, so
    constructing one at all overrides the DOCLING_DEVICE environment variable."""
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    options = recorded_pdf_options(monkeypatch)

    assert options.accelerator_options == PdfPipelineOptions().accelerator_options  # pyright: ignore[reportAttributeAccessIssue]
    assert options.document_timeout is None  # pyright: ignore[reportAttributeAccessIssue]


def test_build_converter_pins_the_device_and_timeout_for_live_ingest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    options = recorded_pdf_options(monkeypatch, device="cpu", document_timeout=60)

    assert options.accelerator_options.device == "cpu"  # pyright: ignore[reportAttributeAccessIssue]
    assert options.document_timeout == 60  # pyright: ignore[reportAttributeAccessIssue]


def test_importing_parse_does_not_load_docling() -> None:
    """Docling drags torch along and costs seconds; anything that only wants
    `normalize_text` or flag validation must not pay for it."""
    result = subprocess.run(
        [sys.executable, "-c", "import rag.parse, sys; print('docling' in sys.modules)"],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"
