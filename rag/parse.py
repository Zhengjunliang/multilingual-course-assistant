"""Step 1 of the ingest pipeline: course PDF -> DoclingDocument -> Markdown.

Parsing errors are frozen into the index forever, so this step is verified on its
own output before anything downstream is built. Run both pipelines over the same
file and compare:

    uv run python -m rag.parse data/corpus/PPM --out-dir data/parsed
    uv run python -m rag.parse "data/corpus/PPM/<slides>.pdf" --ocr
    uv run python -m rag.parse "data/corpus/PPM/<slides>.pdf" --pipeline vlm
"""

import argparse
import time
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

Pipeline = Literal["classic", "vlm"]


@dataclass(frozen=True)
class ParseResult:
    source: Path
    markdown: str
    seconds: float


def normalize_text(text: str) -> str:
    """Fold typographic ligatures so lexical retrieval can match them.

    The corpus contains U+FB01 in strings like `micc.uniﬁ.it`; left alone, a BM25
    query for `unifi` never matches. NFKC also folds full-width forms and
    non-breaking spaces, which is wanted here, but it rewrites superscripts and
    fractions too — acceptable for slides, revisit if formulas start suffering.
    """
    return unicodedata.normalize("NFKC", text)


def build_converter(pipeline: Pipeline, *, ocr: bool = False) -> DocumentConverter:
    """Classic is layout model + TableFormer (+ OCR); vlm runs granite-docling 258M.

    OCR defaults off against Docling's own default: every PDF in this corpus carries
    a text layer, so OCR only burns ~4 s/page returning nothing. Turn it on for the
    slide decks whose text lives inside images.
    """
    if pipeline == "classic":
        options = PdfPipelineOptions()
        options.do_ocr = ocr
        return DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
        )

    # Imported lazily: pulling in the VLM stack costs seconds we do not pay by default.
    from docling.datamodel import vlm_model_specs
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.pipeline.vlm_pipeline import VlmPipeline

    options = VlmPipelineOptions(vlm_options=vlm_model_specs.GRANITEDOCLING_TRANSFORMERS)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_cls=VlmPipeline, pipeline_options=options)
        }
    )


def parse(pdf: Path, converter: DocumentConverter) -> ParseResult:
    started = time.perf_counter()
    document = converter.convert(pdf).document
    elapsed = time.perf_counter() - started
    return ParseResult(
        source=pdf,
        markdown=normalize_text(document.export_to_markdown()),
        seconds=elapsed,
    )


def collect_pdfs(target: Path) -> Iterator[Path]:
    yield from ([target] if target.is_file() else sorted(target.glob("*.pdf")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a PDF, or a directory of PDFs")
    parser.add_argument("--pipeline", choices=["classic", "vlm"], default="classic")
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="run OCR (classic pipeline only); needed only for slides whose text is an image",
    )
    parser.add_argument("--out-dir", type=Path, default=Path("data/parsed"))
    args = parser.parse_args()

    converter = build_converter(args.pipeline, ocr=args.ocr)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    for pdf in collect_pdfs(args.target):
        result = parse(pdf, converter)
        target = args.out_dir / f"{pdf.stem}.{args.pipeline}.md"
        target.write_text(result.markdown, encoding="utf-8")
        print(f"{pdf.name}: {result.seconds:.1f}s, {len(result.markdown)} chars -> {target}")


if __name__ == "__main__":
    main()
