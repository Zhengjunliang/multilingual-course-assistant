"""Step 0 of the ingest pipeline: profile a PDF, then decide how to parse it.

The system ingests whatever a student uploads — a text-only handout, a formula-heavy
theory deck, a scan whose text lives inside images. Asking the uploader which parser
to use pushes a question onto them that they cannot answer; enabling every enrichment
by default makes a plain handout pay for models it never uses; enabling none is what
left `<!-- formula-not-decoded -->` in the parsed corpus.

So parsing is routed per document, from signals this module reads straight out of the
PDF structure — no model is loaded and no page is rendered. Over the 31-deck PPM
corpus (~1200 pages) the whole probe takes seconds and selects the formula model for
4 files and the VLM pipeline for 1, leaving 26 on the plain classic pipeline.

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

# Which parse configuration a profile maps to. Defined here rather than in `parse`
# so that routing stays importable — and testable — without pulling in docling.
Pipeline = Literal["classic", "vlm"]

# A page holding less than this many characters is treated as carrying no text layer.
# Slide decks put little text on a page to begin with, so the bar is low: the corpus
# averages 230-1000 chars/page, and the pages this catches hold a title at most.
EMPTY_PAGE_CHARS = 50

# Above this share of empty pages the text layer is not worth trusting and the whole
# document goes to the VLM pipeline. Measured on the PPM corpus: every deck sits at
# <= 0.24 except `3.5-HTML5-Part-2` at 0.50, whose content genuinely is images.
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
    names = set()
    for name in fonts:
        entry = _resolve(fonts[name])
        if isinstance(entry, DictionaryObject) and (base := entry.get("/BaseFont")) is not None:
            names.add(str(base))
    return names


def probe(pdf: Path) -> DocumentProfile:
    # Several decks in the corpus carry a damaged cross-reference table; pypdf repairs
    # it but logs a line per broken object, which would bury the profile output. The
    # repair itself does not affect any signal read below.
    logging.getLogger("pypdf").setLevel(logging.CRITICAL)

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

    OCR is never switched on automatically. Every deck in the corpus carries a text
    layer, and on such a PDF OCR was measured to return byte-identical output for 62%
    more time. A document whose text layer really is missing is better served by the
    VLM pipeline, which reads layout as well; `--ocr` stays available as a manual
    override for the in-between cases.
    """
    if profile.empty_page_ratio > NEEDS_VISION_RATIO:
        return ParsePlan(
            pipeline="vlm",
            ocr=False,
            formula=False,
            reason=(
                f"{profile.empty_page_ratio:.0%} of pages carry no text layer"
                " -> content is inside the images"
            ),
        )

    if profile.has_math_fonts:
        return ParsePlan(
            pipeline="classic",
            ocr=False,
            formula=True,
            reason=f"math fonts present ({', '.join(profile.math_fonts)})",
        )

    return ParsePlan(
        pipeline="classic",
        ocr=False,
        formula=False,
        reason="text layer intact, no math fonts",
    )


def collect_pdfs(target: Path) -> Iterator[Path]:
    yield from ([target] if target.is_file() else sorted(target.glob("*.pdf")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a PDF, or a directory of PDFs")
    args = parser.parse_args()

    for pdf in collect_pdfs(args.target):
        profile = probe(pdf)
        plan = plan_for(profile)
        print(
            f"{pdf.name}: {profile.pages}p, {profile.chars_per_page} chars/p, "
            f"{profile.empty_page_ratio:.0%} empty, {profile.images} images "
            f"-> {plan.pipeline}{' +formula' if plan.formula else ''} ({plan.reason})"
        )


if __name__ == "__main__":
    main()
