"""Routing decides how every uploaded file gets parsed, so its signals must hold.

The fixtures are synthesised here rather than read from `data/`: course material is
copyrighted, never enters git, and does not exist on the CI runner.
"""

from pathlib import Path

import pytest
from pypdf.errors import PdfReadError

from rag.probe import DocumentProfile, collect_pdfs, find_math_fonts, main, plan_for, probe

# Comfortably longer than EMPTY_PAGE_CHARS, so this page reads as carrying a text layer.
TEXT = (
    b"BT /F1 12 Tf 20 100 Td (Digital images are sampled as a grid of pixels,"
    b" each assigned a tonal value represented in binary code) Tj ET"
)

# One page carrying text in a math font, one page carrying an image and a vector
# drawing but no text at all.
OBJECTS = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R"
    b" /Resources << /Font << /F1 6 0 R >> >> >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]"
    b" /Resources << /XObject << /Im1 7 0 R /Fm1 8 0 R >> >> >>",
    b"<< /Length %d >>\nstream\n" % len(TEXT) + TEXT + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /SymbolMT >>",
    b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray"
    b" /BitsPerComponent 8 /Length 1 >>\nstream\n\x00\nendstream",
    b"<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length 0 >>\nstream\n\nendstream",
]


def build_pdf(objects: list[bytes]) -> bytes:
    """Assemble numbered PDF objects into a file with a correct cross-reference table.

    Written out by hand so the fixture never depends on pypdf's repair path — a probe
    that only works on repaired files would pass here and fail on real uploads.
    """
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


@pytest.fixture
def profile(tmp_path: Path) -> DocumentProfile:
    pdf = tmp_path / "slides.pdf"
    pdf.write_bytes(build_pdf(OBJECTS))
    return probe(pdf)


def test_pages_without_a_text_layer_are_counted(profile: DocumentProfile) -> None:
    assert profile.pages == 2
    assert profile.empty_page_ratio == 0.5


def test_only_image_xobjects_are_counted(profile: DocumentProfile) -> None:
    """/XObject also holds reusable vector drawings; counting those inflates the signal."""
    assert profile.images == 1


def test_math_fonts_are_read_from_the_font_table(profile: DocumentProfile) -> None:
    assert profile.math_fonts == ("/SymbolMT",)
    assert profile.has_math_fonts


def test_body_fonts_are_not_mistaken_for_math_fonts() -> None:
    assert find_math_fonts(["/ABCDEF+Calibri", "/Arial-BoldMT", "/TimesNewRomanPSMT"]) == ()


def test_subset_prefixed_math_fonts_are_still_detected() -> None:
    """PDF subsetting prepends a random six-letter tag, so matching must be on substrings."""
    assert find_math_fonts(["/AAAACW+SymbolMT"]) == ("/AAAACW+SymbolMT",)


def make_profile(*, empty_page_ratio: float, math_fonts: tuple[str, ...] = ()) -> DocumentProfile:
    return DocumentProfile(
        source=Path("slides.pdf"),
        pages=10,
        chars_per_page=400,
        empty_page_ratio=empty_page_ratio,
        images=0,
        math_fonts=math_fonts,
    )


def test_a_missing_text_layer_routes_to_ocr() -> None:
    """Measured against granite-docling on the one qualifying deck: OCR cost half the
    time and kept more distinct words, including literals like `avc1.42e01e`."""
    plan = plan_for(make_profile(empty_page_ratio=0.5))
    assert plan.pipeline == "classic"
    assert plan.ocr


def test_routing_never_selects_the_vlm_pipeline() -> None:
    """It stays reachable through --profile manual, but a paraphrasing model is the
    wrong trade for a lexical index."""
    for ratio in (0.0, 0.31, 0.5, 1.0):
        for fonts in ((), ("/SymbolMT",)):
            assert plan_for(make_profile(empty_page_ratio=ratio, math_fonts=fonts)).pipeline == (
                "classic"
            )


def test_math_fonts_route_to_formula_enrichment() -> None:
    plan = plan_for(make_profile(empty_page_ratio=0.1, math_fonts=("/SymbolMT",)))
    assert plan.pipeline == "classic"
    assert plan.formula


def test_a_scanned_deck_with_formulas_gets_both() -> None:
    """The two signals are independent; an earlier rule let the vision branch mask math."""
    plan = plan_for(make_profile(empty_page_ratio=0.5, math_fonts=("/SymbolMT",)))
    assert plan.ocr
    assert plan.formula


def test_an_intact_text_layer_needs_no_enrichment() -> None:
    plan = plan_for(make_profile(empty_page_ratio=0.1))
    assert plan == plan_for(make_profile(empty_page_ratio=0.1))
    assert plan.pipeline == "classic"
    assert not plan.formula
    assert not plan.ocr


def test_the_vision_threshold_is_exclusive() -> None:
    """Decks sit at up to 0.24 empty pages; only a genuine outlier may cross over."""
    assert not plan_for(make_profile(empty_page_ratio=0.3)).ocr


def test_ocr_stays_off_while_a_text_layer_is_present() -> None:
    """Measured: on a PDF that has a text layer, OCR returns identical bytes for 62% more time."""
    for ratio in (0.0, 0.1, 0.24):
        assert not plan_for(make_profile(empty_page_ratio=ratio)).ocr


def test_probe_raises_on_a_file_that_is_not_a_pdf(tmp_path: Path) -> None:
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"this is not a pdf")
    with pytest.raises(PdfReadError):
        probe(bad)


def test_a_corrupt_file_does_not_abort_a_directory_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Students upload whatever they have; one broken deck must cost one deck, not the
    whole corpus run. The run still exits non-zero so a batch script notices."""
    (tmp_path / "aa-bad.pdf").write_bytes(b"this is not a pdf")
    (tmp_path / "zz-good.pdf").write_bytes(build_pdf(OBJECTS))

    with pytest.raises(SystemExit) as excinfo:
        main([str(tmp_path)])

    assert excinfo.value.code == 1
    # The corrupt file sorts first, so this line proves processing continued past it.
    assert "zz-good.pdf" in capsys.readouterr().out


def test_collect_pdfs_finds_nested_and_uppercase_files(tmp_path: Path) -> None:
    """Course folders nest by topic, and Windows-born files may carry `.PDF`, which a
    bare glob("*.pdf") silently skips on Linux."""
    (tmp_path / "sub").mkdir()
    (tmp_path / "a.pdf").write_bytes(b"")
    (tmp_path / "sub" / "b.PDF").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("not a pdf")

    assert list(collect_pdfs(tmp_path)) == sorted([tmp_path / "a.pdf", tmp_path / "sub" / "b.PDF"])


def test_collect_pdfs_passes_a_single_file_through(tmp_path: Path) -> None:
    pdf = tmp_path / "one.pdf"
    pdf.write_bytes(b"")
    assert list(collect_pdfs(pdf)) == [pdf]
