"""Normalisation has to hold, or lexical retrieval silently misses matches; the CLI
flag rules and variant names are pure logic guarding user-facing behaviour."""

import hashlib
import io
import subprocess
import sys
import unicodedata
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest
from pypdf import PdfWriter

from rag.parse import (
    IncompletePdfError,
    ParsedMeta,
    PdfTimeoutError,
    UnreadablePdfError,
    build_converter,
    main,
    normalize_text,
    parse_pdf,
    persist,
    variant_of,
)
from rag.probe import ParsePlan, Pipeline

if TYPE_CHECKING:
    from docling.document_converter import DocumentConverter
    from docling_core.types.doc.document import DoclingDocument

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
    assert meta.academic_year is None
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


PLAIN = "Digital images are sampled as a grid of pixels."


@pytest.mark.parametrize(
    ("text", "normal"),
    [
        # The corpus contains U+FB01 in `micc.uniﬁ.it`; a query for `unifi` must match.
        pytest.param("micc.uniﬁ.it", "micc.unifi.it", id="a-ligature"),
        # PDF extraction can emit `e` + combining acute, which tokenises differently.
        pytest.param(unicodedata.normalize("NFD", COMPOSED), COMPOSED, id="a-decomposed-accent"),
        pytest.param(PLAIN, PLAIN, id="already-normal"),
    ],
)
def test_text_is_normalised_before_it_is_indexed(text: str, normal: str) -> None:
    # Only the plain row may start out normal: a fixture that is not really
    # decomposed would pass without testing anything.
    assert (text == normal) == (text is PLAIN)
    assert normalize_text(text) == normal


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


def test_manual_flags_are_rejected_under_auto_profile(capsys: pytest.CaptureFixture[str]) -> None:
    """Silently ignoring --ocr under --profile auto would parse with a configuration
    the user did not ask for; argparse must refuse before any file is touched."""
    with pytest.raises(SystemExit):
        main(["missing.pdf", "--course", "B028451", "--academic-year", "2025-2026", "--ocr"])
    assert "--profile manual" in capsys.readouterr().err


def test_classic_only_flags_are_rejected_on_the_vlm_pipeline(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit):
        main(
            [
                "missing.pdf",
                "--course",
                "B028451",
                "--academic-year",
                "2025-2026",
                "--profile",
                "manual",
                "--pipeline",
                "vlm",
                "--ocr",
            ]
        )
    assert "classic pipeline only" in capsys.readouterr().err


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


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        pytest.param(["--academic-year", "2025-2026"], "--course", id="no-course"),
        pytest.param(["--course", "B028451"], "--academic-year", id="no-year"),
        pytest.param(
            ["--course", "B028451", "--academic-year", "2025/2026"],
            "invariant 1",
            id="malformed-year",
        ),
    ],
)
def test_parse_requires_the_edition(
    args: list[str], expected: str, capsys: pytest.CaptureFixture[str]
) -> None:
    """`rag.parse` takes the edition from its flags, never from the target
    directory name (docs/decisions.md, 2026-09-28, *Slides points carry their
    edition, and a re-index replaces a source file within it*): both flags are
    required, and a malformed one is refused before any file is touched."""
    with pytest.raises(SystemExit):
        main(["missing.pdf", *args])
    assert expected in capsys.readouterr().err


CLASSIC = ParsePlan(pipeline="classic", ocr=False, formula=False, reason="manual")


class StubConverter:
    """Answers `convert` with a fixed status and document, or raises; docling's own result,
    minus the models. The document is empty unless one is given."""

    def __init__(
        self,
        status: str = "success",
        error: Exception | None = None,
        document: "DoclingDocument | None" = None,
        *,
        timed_out: bool = False,
    ) -> None:
        self.status = status
        self.error = error
        self.document = document
        self.timed_out = timed_out
        self.calls = 0

    def convert(self, source: Path) -> SimpleNamespace:
        from docling.datamodel.base_models import (
            ConversionStatus,
            DoclingComponentType,
            ErrorItem,
            FailureCategory,
        )
        from docling_core.types.doc.document import DoclingDocument

        self.calls += 1
        if self.error is not None:
            raise self.error
        # What docling files when it stops at `document_timeout`, beside a PARTIAL_SUCCESS.
        timeout = ErrorItem(
            component_type=DoclingComponentType.PIPELINE,
            module_name="StandardPdfPipeline",
            error_message="Pipeline stage timeout",
            category=FailureCategory.TIMEOUT,
        )
        return SimpleNamespace(
            status=ConversionStatus(self.status),
            document=self.document or DoclingDocument(name=source.stem),
            errors=[timeout] if self.timed_out else [],
        )


def blank_pdf(pages: int = 1, *, title: str = "") -> bytes:
    """A PDF of blank pages, its title making the bytes of one apart from another's."""
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    if title:
        writer.add_metadata({"/Title": title})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def encrypted_pdf() -> bytes:
    """One blank page behind a user password, which nothing here knows."""
    # RC4 because pypdf writes AES only with `cryptography`, which nothing here installs.
    password = "secret"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt(user_password=password, algorithm="RC4-128")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def stored_pdf(tmp_path: Path) -> Path:
    """A file named by its digest, as the material store names it; its bytes are never parsed."""
    path = tmp_path / f"{'ab' * 32}.pdf"
    path.write_bytes(b"%PDF-1.7")
    return path


def test_a_parsed_pdf_records_its_edition_and_the_name_it_was_uploaded_as(
    tmp_path: Path,
) -> None:
    converter = StubConverter()
    converters = {"classic": cast("DocumentConverter", converter)}
    pdf = stored_pdf(tmp_path)

    parsed = parse_pdf(
        pdf,
        course="B028451",
        academic_year="2025-2026",
        source_file="01-Intro.pdf",
        converters=converters,
        plan=CLASSIC,
    )
    parse_pdf(
        pdf,
        course="B028451",
        academic_year="2025-2026",
        source_file="01-Intro.pdf",
        converters=converters,
        plan=CLASSIC,
    )

    assert (parsed.meta.source_file, parsed.meta.course, parsed.meta.academic_year) == (
        "01-Intro.pdf",
        "B028451",
        "2025-2026",
    )
    assert parsed.meta.source_sha256 == hashlib.sha256(b"%PDF-1.7").hexdigest()
    assert parsed.meta.parse_variant == "classic"
    # The cached converter served both files; no second one was built.
    assert (list(converters), converter.calls) == (["classic"], 2)


@pytest.mark.parametrize(
    ("converter", "error"),
    [
        pytest.param(StubConverter("partial_success"), IncompletePdfError, id="stopped-part-way"),
        pytest.param(
            StubConverter("partial_success", timed_out=True),
            PdfTimeoutError,
            id="stopped-by-the-timeout",
        ),
        pytest.param(None, UnreadablePdfError, id="refused-by-docling"),
    ],
)
def test_only_a_clean_conversion_is_returned(
    converter: StubConverter | None, error: type[Exception], tmp_path: Path
) -> None:
    """A truncated document indexed would freeze its missing pages out of the index."""
    from docling.exceptions import ConversionError

    stub = converter or StubConverter(error=ConversionError("Conversion failed"))

    with pytest.raises(error):
        parse_pdf(
            stored_pdf(tmp_path),
            course="B028451",
            academic_year="2025-2026",
            source_file="deck.pdf",
            converters={"classic": cast("DocumentConverter", stub)},
            plan=CLASSIC,
        )


def test_a_converter_built_for_a_caller_stops_at_its_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The material ingest's clock (apps/materials/ingest.py) reaches the converter it builds."""
    built: list[float | None] = []

    def build(pipeline: Pipeline, **options: object) -> StubConverter:
        built.append(cast("float | None", options["document_timeout"]))
        return StubConverter()

    monkeypatch.setattr("rag.parse.build_converter", build)

    parse_pdf(
        stored_pdf(tmp_path),
        course="B028451",
        academic_year="2025-2026",
        source_file="deck.pdf",
        converters={},
        plan=CLASSIC,
        document_timeout=300,
    )

    assert built == [300]


def test_the_worker_decodes_formulas_on_whatever_the_probe_routes(tmp_path: Path) -> None:
    """A blank page has no text layer, so the probe asks for OCR and no formulas."""
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    pdf = tmp_path / "scan.pdf"
    with pdf.open("wb") as handle:
        writer.write(handle)
    converter = StubConverter()

    parsed = parse_pdf(
        pdf,
        course="B028451",
        academic_year="2025-2026",
        source_file="scan.pdf",
        converters={"classic-ocr-formula": cast("DocumentConverter", converter)},
        formula=True,
    )

    assert parsed.meta.parse_variant == "classic-ocr-formula"
    assert converter.calls == 1


def test_an_encrypted_pdf_is_unreadable_before_any_model_loads(tmp_path: Path) -> None:
    pdf = tmp_path / "locked.pdf"
    pdf.write_bytes(encrypted_pdf())
    converters: dict[str, DocumentConverter] = {}

    with pytest.raises(UnreadablePdfError):
        parse_pdf(
            pdf,
            course="B028451",
            academic_year="2025-2026",
            source_file="locked.pdf",
            converters=converters,
        )
    assert converters == {}


def classic_pdf_options(**kwargs: object) -> object:
    """The PDF pipeline options of a real classic converter. Building one loads
    no model — docling initialises a pipeline on its first conversion — so the
    options are read straight off the converter the code returns."""
    from docling.datamodel.base_models import InputFormat

    converter = build_converter("classic", **kwargs)  # pyright: ignore[reportArgumentType] - forwarded kwargs
    return converter.format_to_options[InputFormat.PDF].pipeline_options


def test_build_converter_leaves_docling_own_accelerator_default_alone() -> None:
    """`device=None` must mean "docling decides", which is not the same as
    passing its "auto" sentinel: `AcceleratorOptions` is a BaseSettings, so
    constructing one at all overrides the DOCLING_DEVICE environment variable."""
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    options = classic_pdf_options()

    assert options.accelerator_options == PdfPipelineOptions().accelerator_options  # pyright: ignore[reportAttributeAccessIssue]
    assert options.document_timeout is None  # pyright: ignore[reportAttributeAccessIssue]


def test_build_converter_pins_the_device_and_timeout_for_live_ingest() -> None:
    options = classic_pdf_options(device="cpu", document_timeout=60)

    assert options.accelerator_options.device == "cpu"  # pyright: ignore[reportAttributeAccessIssue]
    assert options.document_timeout == 60  # pyright: ignore[reportAttributeAccessIssue]


@pytest.mark.parametrize("pipeline", ["classic", "vlm"])
def test_build_converter_skips_a_document_that_is_not_a_pdf(pipeline: Pipeline) -> None:
    """Docling picks the backend from the bytes, not the name, and the live path
    names whatever a server sends as a PDF `*.pdf`. An OpenDocument archive under
    that name would reach the OpenDocument backend, which reads a local path the
    document names (CVE-2026-105751), so the converter admits PDFs only and skips
    the rest before any backend loads."""
    from docling.datamodel.base_models import ConversionStatus, DocumentStream, InputFormat

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as odt:
        odt.writestr("mimetype", "application/vnd.oasis.opendocument.text")
        odt.writestr("content.xml", "<office:document-content/>")
    stream = DocumentStream(name="attachment.pdf", stream=io.BytesIO(archive.getvalue()))

    result = build_converter(pipeline).convert(stream, raises_on_error=False)

    assert result.input.format == InputFormat.ODT
    assert result.status == ConversionStatus.SKIPPED


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
