"""Probe Docling parsing quality on Italian course slides (M1 minimal experiment).

Run one pipeline at a time and diff the outputs by hand:

    uv run parse.py data/lezione.pdf
    uv run parse.py data/lezione.pdf --pipeline vlm

Checks that matter for the thesis corpus: Italian accented characters,
formulas, table structure, and reading order on multi-column slides.
"""

import argparse
import time
from pathlib import Path

from docling.document_converter import DocumentConverter


def build_converter(pipeline: str) -> DocumentConverter:
    """Classic pipeline is layout model + OCR; vlm runs granite-docling 258M."""
    if pipeline == "classic":
        return DocumentConverter()

    from docling.datamodel import vlm_model_specs
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.document_converter import PdfFormatOption
    from docling.pipeline.vlm_pipeline import VlmPipeline

    options = VlmPipelineOptions(vlm_options=vlm_model_specs.GRANITEDOCLING_TRANSFORMERS)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=VlmPipeline,
                pipeline_options=options,
            )
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="source PDF to parse")
    parser.add_argument("--pipeline", choices=["classic", "vlm"], default="classic")
    parser.add_argument("--out-dir", type=Path, default=Path("out"))
    args = parser.parse_args()

    converter = build_converter(args.pipeline)

    started = time.perf_counter()
    document = converter.convert(args.pdf).document
    elapsed = time.perf_counter() - started

    markdown = document.export_to_markdown()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    target = args.out_dir / f"{args.pdf.stem}.{args.pipeline}.md"
    target.write_text(markdown, encoding="utf-8")

    print(f"{args.pipeline}: {elapsed:.1f}s, {len(markdown)} chars -> {target}")


if __name__ == "__main__":
    main()
