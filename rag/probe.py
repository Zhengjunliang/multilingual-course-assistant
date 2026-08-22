"""Step 0 of the ingest pipeline: profile a PDF, then decide how to parse it.

The system ingests whatever a student uploads — a text-only handout, a formula-heavy
theory deck, a scan whose text lives inside images. Asking the uploader which parser
to use pushes a question onto them that they cannot answer; enabling every enrichment
by default makes a plain handout pay for models it never uses; enabling none is what
left `<!-- formula-not-decoded -->` in the parsed corpus.

So parsing is routed per document, from signals this module reads straight out of the
PDF structure — no model is loaded and no page is rendered. Over the 31-deck PPM
corpus (~1200 pages) the whole probe takes seconds and turns on formula decoding for
4 files and OCR for 1, leaving 26 on the plain classic pipeline.

    uv run python -m rag.probe data/corpus/PPM
"""

import argparse
import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pypdf import PdfReader
from pypdf.generic import DictionaryObject, IndirectObject

logger = logging.getLogger(__name__)

# Which parse configuration a profile maps to. Defined here rather than in `parse`
# so that routing stays importable — and testable — without pulling in docling.
Pipeline = Literal["classic", "vlm"]

# A page holding less than this many characters is treated as carrying no text layer.
# Slide decks put little text on a page to begin with, so the bar is low: the corpus
# averages 230-1000 chars/page, and the pages this catches hold a title at most.
EMPTY_PAGE_CHARS = 50

# Above this share of empty pages the text layer is not worth trusting and the text has
# to be recovered from the rendered page instead. Measured on the PPM corpus: every deck
# sits at <= 0.24 except `3.5-HTML5-Part-2` at 0.50, whose content genuinely is images.
NEEDS_VISION_RATIO = 0.3

# Substrings of PostScript font names that indicate mathematical typesetting: the
# Symbol/Math families ship the glyphs (integrals, large brackets, greek) that text
# fonts lack, so their presence means formulas are on the page.
#
# This over-triggers: PowerPoint also draws bullet glyphs with SymbolMT. That is the
# intended direction of error. Docling runs the formula model per detected formula
# region, so a false positive costs one model load and nothing more, while a false
# negative loses the formula from the index permanently.
MATH_FONT_HINTS = (
    "Symbol",
    "CMMI",
    "CMEX",
    "CMSY",
    "MTSY",
    "MathematicalPi",
    "Cambria Math",
    "STIX",
)


@dataclass(frozen=True)
class DocumentProfile:
    source: Path
    pages: int
    chars_per_page: int
    empty_page_ratio: float
    images: int
    math_fonts: tuple[str, ...]

    @property
    def has_math_fonts(self) -> bool:
        return bool(self.math_fonts)


@dataclass(frozen=True)
class ParsePlan:
    pipeline: Pipeline
    ocr: bool
    formula: bool
    reason: str


def find_math_fonts(font_names: Iterable[str]) -> tuple[str, ...]:
    """Return the subset of `font_names` that look like math fonts, in stable order."""
    lowered = [hint.lower() for hint in MATH_FONT_HINTS]
    return tuple(
        sorted({name for name in font_names if any(hint in name.lower() for hint in lowered)})
    )


def _resolve(value: object) -> object:
    return value.get_object() if isinstance(value, IndirectObject) else value


def _resource(page: DictionaryObject, key: str) -> DictionaryObject | None:
    """Read one entry out of a page's /Resources, resolving indirect references."""
    resources = _resolve(page.get("/Resources"))
    if not isinstance(resources, DictionaryObject):
        return None
    entry = _resolve(resources.get(key))
    return entry if isinstance(entry, DictionaryObject) else None


def _count_images(page: DictionaryObject) -> int:
    xobjects = _resource(page, "/XObject")
    if xobjects is None:
        return 0
    # /XObject also holds reusable vector drawings (/Form); only /Image counts here.
    return sum(
        1
        for name in xobjects
        if isinstance(entry := _resolve(xobjects[name]), DictionaryObject)
        and entry.get("/Subtype") == "/Image"
    )


def _font_names(page: DictionaryObject) -> set[str]:
    fonts = _resource(page, "/Font")
    if fonts is None:
        return set()
    names: set[str] = set()
    for name in fonts:
        entry = _resolve(fonts[name])
        if isinstance(entry, DictionaryObject) and (base := entry.get("/BaseFont")) is not None:
            names.add(str(base))
    return names


def probe(pdf: Path) -> DocumentProfile:
    reader = PdfReader(pdf)
    chars: list[int] = []
    images = 0
    fonts: set[str] = set()

    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            # A page whose content stream will not decode yields no text layer, which
            # is exactly the signal an empty page carries. Do not fail the whole file.
            text = ""
        chars.append(len(text))
        images += _count_images(page)
        fonts |= _font_names(page)

    pages = len(chars)
    empty = sum(1 for count in chars if count < EMPTY_PAGE_CHARS)
    return DocumentProfile(
        source=pdf,
        pages=pages,
        chars_per_page=sum(chars) // pages if pages else 0,
        empty_page_ratio=empty / pages if pages else 1.0,
        images=images,
        math_fonts=find_math_fonts(fonts),
    )


def plan_for(profile: DocumentProfile) -> ParsePlan:
    """Map a profile onto a parse configuration.

    Routing never selects the VLM pipeline. It was the obvious choice for a document
    whose text layer is missing, until the two were compared on the one file in the
    corpus that qualifies: granite-docling took 1059 s against OCR's 527 s and, with
    the repeated page header discounted, produced *fewer* distinct words (671 vs 729).
    Its exclusive vocabulary was prose — `allows`, `becomes`, `comes` — while OCR's
    was the literal kind retrieval depends on: `avc1.42e01e`, `ajax.googleapis.com`,
    `autoplay`. A VLM paraphrases where OCR transcribes, and paraphrase is the wrong
    trade for a lexical index. `--profile manual --pipeline vlm` keeps it reachable
    for comparison.

    OCR stays off for everything else: on a PDF that does have a text layer it was
    measured to return byte-identical output for 62% more time.
    """
    needs_ocr = profile.empty_page_ratio > NEEDS_VISION_RATIO
    reasons: list[str] = []
    if needs_ocr:
        reasons.append(f"{profile.empty_page_ratio:.0%} of pages carry no text layer")
    if profile.has_math_fonts:
        reasons.append(f"math fonts present ({', '.join(profile.math_fonts)})")

    return ParsePlan(
        pipeline="classic",
        ocr=needs_ocr,
        formula=profile.has_math_fonts,
        reason=" + ".join(reasons) or "text layer intact, no math fonts",
    )


def collect_pdfs(target: Path) -> Iterator[Path]:
    if target.is_file():
        yield target
        return
    # rglob + suffix casefold: course folders nest by topic, and files arriving from
    # Windows machines may carry `.PDF`, which a bare glob("*.pdf") skips on Linux.
    yield from sorted(p for p in target.rglob("*") if p.is_file() and p.suffix.lower() == ".pdf")


def configure_cli_logging() -> None:
    """Shared by the probe and parse CLIs; a batch over a corpus runs for minutes to
    hours, so every diagnostic line carries a timestamp."""
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # Several decks in the corpus carry a damaged cross-reference table; pypdf repairs
    # it but logs a line per broken object, which would bury the report lines. The
    # repair itself does not affect any signal probe() reads.
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    # Model loads fire dozens of INFO-level hub freshness checks (one HEAD request
    # per config file) that would bury the actual results.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("huggingface_hub").setLevel(logging.WARNING)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a PDF, or a directory of PDFs")
    args = parser.parse_args(argv)
    configure_cli_logging()

    failed = 0
    for pdf in collect_pdfs(args.target):
        try:
            profile = probe(pdf)
        except Exception:
            # One corrupt upload must not abort the rest of a corpus run.
            logger.exception("%s: probe failed", pdf.name)
            failed += 1
            continue
        plan = plan_for(profile)
        flags = "".join(
            f" +{name}" for name, on in (("ocr", plan.ocr), ("formula", plan.formula)) if on
        )
        # The report line is the command's product, not a diagnostic: plain stdout.
        print(
            f"{pdf.name}: {profile.pages}p, {profile.chars_per_page} chars/p, "
            f"{profile.empty_page_ratio:.0%} empty, {profile.images} images "
            f"-> {plan.pipeline}{flags} ({plan.reason})"
        )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
