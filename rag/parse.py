"""Step 1 of the ingest pipeline: course PDF -> DoclingDocument -> lossless JSON.

Parsing errors are frozen into the index forever, so this step is verified on its
own output before anything downstream is built. Each file lands as two artifacts:
`<stem>.<variant>.json` (the DoclingDocument, the only input chunking needs) and
`<stem>.<variant>.meta.json` (provenance sidecar), so later steps never touch the
original PDF and never import docling. By default each file is profiled first and
parsed with the configuration that profile calls for (see `rag.probe`);
`--profile manual` forces one configuration, which is what experiments need:

    uv run python -m rag.parse data/corpus/PPM --out-dir data/parsed
    uv run python -m rag.parse "data/corpus/PPM/<slides>.pdf" --profile manual --ocr
    uv run python -m rag.parse "data/corpus/PPM/<slides>.pdf" --profile manual --pipeline vlm
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import time
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict

from rag.probe import ParsePlan, Pipeline, collect_pdfs, configure_cli_logging, plan_for, probe

if TYPE_CHECKING:
    from docling.document_converter import DocumentConverter
    from docling_core.types.doc.document import DoclingDocument

logger = logging.getLogger(__name__)

# Default output anchored to the repo, not the cwd: an ingest launched from any
# directory must land its artifacts where the rest of the pipeline expects them.
DEFAULT_OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "parsed"


class ParsedMeta(BaseModel):
    """Provenance sidecar written next to each document JSON.

    Exists so the chunking step never opens the original PDF, never imports
    docling, and never recomputes a hash: every field an index payload needs
    to attribute a chunk to its parse configuration and corpus snapshot is
    frozen here at parse time (M3's ablations depend on that attribution).
    """

    model_config = ConfigDict(frozen=True)

    source_file: str
    source_path: str
    source_sha256: str
    parse_variant: str
    docling_version: str
    course: str
    seconds: float
    parsed_at: str
    # Web-source provenance (M2.5), threaded through to the chunk payload.
    # All optional with defaults so every sidecar already on disk stays valid;
    # the PDF path never sets them (a legal terminal state, not missing data).
    # Field semantics are owned by docs/docling-e-pipeline.md.
    kind: Literal["slides", "web"] = "slides"
    lang: str | None = None
    url: str | None = None
    referrer_url: str | None = None
    fetch_date: str | None = None
    section: str | None = None
    ingest_run_id: str | None = None
    ingest_source: Literal["crawl", "live"] | None = None
    trigger: str | None = None
    content_hash: str | None = None


@dataclass(frozen=True)
class ParseResult:
    source: Path
    document: DoclingDocument
    seconds: float


def normalize_text(text: str) -> str:
    """Fold typographic ligatures so lexical retrieval can match them.

    The corpus contains U+FB01 in strings like `micc.uniﬁ.it`; left alone, a BM25
    query for `unifi` never matches. NFKC also folds full-width forms and
    non-breaking spaces, which is wanted here, but it rewrites superscripts and
    fractions too — acceptable for slides, revisit if formulas start suffering.

    The DoclingDocument JSON keeps the original text; this is applied by the
    chunking step to every chunk it emits, so the index only ever sees folded text.
    """
    return unicodedata.normalize("NFKC", text)


def sha256_of(path: Path) -> str:
    """Content hash of the original PDF: the corpus-snapshot identity of every
    chunk derived from it."""
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def build_converter(
    pipeline: Pipeline, *, ocr: bool = False, formula: bool = False
) -> DocumentConverter:
    """Classic is layout model + TableFormer (+ OCR, + formulas); vlm runs granite-docling 258M.

    Both enrichments default off here against Docling's own default for OCR, because
    a CLI run pays the model download and load in full. That reasoning does not carry
    over to the Celery worker in M5: a long-lived process pays the load once, and
    Docling triggers the formula model per detected formula region, so leaving it on
    server-side costs nothing on documents that have no formulas.

    Picture description belongs here too and is not implemented yet — M3 will attach
    `do_picture_description` with `PictureDescriptionApiOptions` pointing at the vLLM
    endpoint on MICC (the `qwen` preset is Qwen2.5-VL-3B, so it stays inside the
    open-weight constraint), with `picture_area_threshold` keeping decorative images
    out of the bill.

    All docling imports live inside this function: importing them at module level
    costs seconds and drags torch along, which anything that only wants
    `normalize_text` or the CLI flag validation should never pay.
    """
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter, PdfFormatOption

    if pipeline == "classic":
        from docling.datamodel.pipeline_options import PdfPipelineOptions

        options = PdfPipelineOptions()
        options.do_ocr = ocr
        options.do_formula_enrichment = formula
        return DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
        )

    from docling.datamodel import vlm_model_specs
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.pipeline.vlm_pipeline import VlmPipeline

    vlm_options = VlmPipelineOptions(vlm_options=vlm_model_specs.GRANITEDOCLING_TRANSFORMERS)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_cls=VlmPipeline, pipeline_options=vlm_options)
        }
    )


def cuda_available() -> bool:
    """Docling picks the device itself (`AcceleratorOptions.device` defaults to AUTO);
    this only decides whether to warn that a run is about to be unbearably slow."""
    import torch

    return torch.cuda.is_available()


def docling_version() -> str:
    """Read lazily: version metadata must not cost a docling import at module level."""
    import docling

    return docling.__version__


def variant_of(plan: ParsePlan) -> str:
    """Name the configuration, so two runs over the same deck stay comparable on disk."""
    parts = [plan.pipeline]
    if plan.ocr:
        parts.append("ocr")
    if plan.formula:
        parts.append("formula")
    return "-".join(parts)


def parse(pdf: Path, converter: DocumentConverter) -> ParseResult:
    started = time.perf_counter()
    document = converter.convert(pdf).document
    elapsed = time.perf_counter() - started
    return ParseResult(source=pdf, document=document, seconds=elapsed)


def persist(document: DoclingDocument, meta: ParsedMeta, out_dir: Path) -> tuple[Path, Path]:
    """Write the document JSON and its provenance sidecar as one unit.

    The two files share the `<stem>.<variant>` key so the chunking step can pair
    them back up with nothing but a directory listing.
    """
    stem = Path(meta.source_file).stem
    doc_path = out_dir / f"{stem}.{meta.parse_variant}.json"
    meta_path = out_dir / f"{stem}.{meta.parse_variant}.meta.json"
    document.save_as_json(doc_path)
    meta_path.write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return doc_path, meta_path


def course_of(target: Path) -> str:
    """Default course name from the layout `data/corpus/<course>/...`."""
    base = target if target.is_dir() else target.parent
    return base.name


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a PDF, or a directory of PDFs")
    parser.add_argument(
        "--profile",
        choices=["auto", "manual"],
        default="auto",
        help="auto: route each file on its own profile; manual: use the flags below",
    )
    parser.add_argument("--pipeline", choices=["classic", "vlm"], default=None)
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="run OCR (classic pipeline only); needed only for slides whose text is an image",
    )
    parser.add_argument(
        "--formula",
        action="store_true",
        help="decode formulas to LaTeX (classic pipeline only)",
    )
    parser.add_argument(
        "--course",
        default=None,
        help="course label carried into every chunk payload; defaults to the target directory name",
    )
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    manual = args.profile == "manual"
    if not manual and (args.pipeline or args.ocr or args.formula):
        parser.error("--pipeline/--ocr/--formula require --profile manual")
    if manual and (args.ocr or args.formula) and (args.pipeline or "classic") != "classic":
        parser.error("--ocr and --formula apply to the classic pipeline only")

    configure_cli_logging()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    course = args.course or course_of(args.target)

    # One converter per distinct configuration, not per file: rebuilding it would
    # reload the layout and table models for every deck in the directory.
    converters: dict[str, DocumentConverter] = {}

    pdfs = list(collect_pdfs(args.target))
    failed = 0
    for pdf in pdfs:
        try:
            if manual:
                plan = ParsePlan(
                    pipeline=args.pipeline or "classic",
                    ocr=args.ocr,
                    formula=args.formula,
                    reason="manual",
                )
            else:
                plan = plan_for(probe(pdf))

            variant = variant_of(plan)
            if plan.pipeline == "vlm" and not cuda_available():
                # granite-docling generates DocTags autoregressively, thousands of
                # tokens a page, each one a full forward pass. Measured without CUDA:
                # over 56 s/page against 0.9 s/page for the classic pipeline. Warn
                # rather than refuse — the run is valid, just far too slow to iterate on.
                logger.warning("%s: no CUDA device, vlm will take minutes per page", pdf.name)
            if variant not in converters:
                converters[variant] = build_converter(
                    plan.pipeline, ocr=plan.ocr, formula=plan.formula
                )

            result = parse(pdf, converters[variant])
            meta = ParsedMeta(
                source_file=pdf.name,
                source_path=str(pdf.resolve()),
                source_sha256=sha256_of(pdf),
                parse_variant=variant,
                docling_version=docling_version(),
                course=course,
                seconds=round(result.seconds, 1),
                parsed_at=datetime.now(UTC).isoformat(timespec="seconds"),
            )
            doc_path, _ = persist(result.document, meta, args.out_dir)
        except Exception:
            # A parse crash on one deck must not lose the rest of an hour-long run.
            logger.exception("%s: parse failed", pdf.name)
            failed += 1
            continue

        logger.info(
            # ASCII only: the Windows console codepage mangles anything else.
            "%s: %s (%s) - %.1fs, %d items -> %s",
            pdf.name,
            variant,
            plan.reason,
            result.seconds,
            len(result.document.texts),
            doc_path,
        )

    # The summary is the command's product: how much of the corpus is now on disk.
    print(f"parsed {len(pdfs) - failed}/{len(pdfs)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
