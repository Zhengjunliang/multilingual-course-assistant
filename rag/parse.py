"""Step 1 of the ingest pipeline: course PDF -> DoclingDocument -> lossless JSON.

Parsing errors are frozen into the index forever, so this step is verified on its
own output before anything downstream is built. Each file lands as two artifacts:
`<stem>.<variant>.json` (the DoclingDocument, the only input chunking needs) and
`<stem>.<variant>.meta.json` (provenance sidecar), so later steps never touch the
original PDF and never import docling. By default each file is profiled first and
parsed with the configuration that profile calls for (see `rag.probe`);
`--profile manual` forces one configuration, which is what experiments need:

    uv run python -m rag.parse data/corpus/PPM \
        --course B028451 --academic-year 2025-2026 --out-dir data/parsed
    uv run python -m rag.parse "data/corpus/PPM/<slides>.pdf" \
        --course B028451 --academic-year 2025-2026 --profile manual --ocr
    uv run python -m rag.parse "data/corpus/PPM/<slides>.pdf" \
        --course B028451 --academic-year 2025-2026 --profile manual --pipeline vlm
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import time
import unicodedata
from dataclasses import dataclass, replace
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
    # The academic year of a slides edition, alongside `course`
    # (`rag/chunk.py`, `EditionKey`); a plain string, not the pattern-checked
    # `AcademicYear` — checking it here would need `rag.chunk`, which already
    # imports this module. None in a sidecar written before `#96`.
    academic_year: str | None = None
    # Web-source provenance, threaded through to the chunk payload.
    # All optional with defaults so every sidecar already on disk stays valid;
    # the PDF path never sets them (a legal terminal state, not missing data).
    # Field semantics are owned by docs/docling-pipeline.md.
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


class UnreadablePdfError(Exception):
    """The PDF could not be opened or converted: encrypted, malformed, or not a PDF."""


class IncompletePdfError(Exception):
    """Docling converted the PDF only in part; a half-converted document is never stored."""


@dataclass(frozen=True)
class ParsedPdf:
    document: DoclingDocument
    meta: ParsedMeta
    plan: ParsePlan


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
    pipeline: Pipeline,
    *,
    ocr: bool = False,
    formula: bool = False,
    device: str | None = None,
    document_timeout: float | None = None,
) -> DocumentConverter:
    """Classic is layout model + TableFormer (+ OCR, + formulas); vlm runs granite-docling 258M.

    `device` and `document_timeout` are classic-pipeline knobs for the live
    ingest path (`rag.live`), where parsing must stay off the GPU and inside a
    step budget. Both default to leaving docling's own behaviour untouched, so
    every existing call is unchanged. `device=None` means exactly that and is
    not the same as `device="auto"`: `AcceleratorOptions` is a `BaseSettings`,
    so constructing one at all overrides whatever `DOCLING_DEVICE` says, even
    with docling's own sentinel value.

    Both enrichments default off here against Docling's own default for OCR, because
    a CLI run pays the model download and load in full. That reasoning does not carry
    over to the material ingest's worker: a long-lived process pays the load once, and
    Docling triggers the formula model per detected formula region, so it parses with
    formulas on (`parse_pdf`'s `formula`) at no cost to documents that have none.

    Picture description belongs here too and is not implemented yet — M3 will attach
    `do_picture_description` with `PictureDescriptionApiOptions` pointing at the vLLM
    endpoint on MICC (the `qwen` preset is Qwen2.5-VL-3B, so it stays inside the
    open-weight constraint), with `picture_area_threshold` keeping decorative images
    out of the bill.

    Both converters admit PDFs and nothing else. Docling picks the backend from the
    bytes rather than the name, and by default admits every format it knows, so an
    OpenDocument archive named `.pdf` would reach the OpenDocument backend, which
    reads a local path the document names (CVE-2026-105751). Any other format is
    skipped.

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
        if device is not None:
            from docling.datamodel.accelerator_options import AcceleratorOptions

            options.accelerator_options = AcceleratorOptions(device=device)
        options.document_timeout = document_timeout
        return DocumentConverter(
            allowed_formats=[InputFormat.PDF],
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
        )

    from docling.datamodel import vlm_model_specs
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.pipeline.vlm_pipeline import VlmPipeline

    vlm_options = VlmPipelineOptions(vlm_options=vlm_model_specs.GRANITEDOCLING_TRANSFORMERS)
    return DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_cls=VlmPipeline, pipeline_options=vlm_options)
        },
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


def parse_pdf(
    pdf: Path,
    *,
    course: str,
    academic_year: str,
    source_file: str,
    converters: dict[str, DocumentConverter],
    plan: ParsePlan | None = None,
    formula: bool = False,
) -> ParsedPdf:
    """One PDF of an edition -> its DoclingDocument and provenance, or an error.

    The file is profiled and routed (`rag.probe`) unless `plan` forces a
    configuration. `converters` is the caller's cache, one converter per
    variant, filled here as variants come up: building one reloads the layout
    and table models, which a directory run or a long-lived worker pays once.
    `source_file` is the name the provenance records, which is not the path's
    when the file on disk is named by its digest (apps/materials/models.py).
    `formula` decodes formulas on the classic pipeline whatever the profile
    says, as the resident worker does (`build_converter`); it also halves the
    variants that worker keeps a converter for.

    Only a clean conversion is returned, by the rule `rag.live` applies to a
    fetched page: a conversion that stops part way comes back from docling as
    PARTIAL_SUCCESS, with a truncated document and no exception, and indexing
    it would freeze the missing pages out of the index unnoticed.
    """
    from docling.datamodel.base_models import ConversionStatus
    from docling.exceptions import ConversionError

    try:
        plan = plan or plan_for(probe(pdf))
    except Exception as exc:
        # The probe reads nothing but the file, and pypdf raises more than its
        # own errors on a broken one: a DependencyError for an AES-encrypted
        # file without `cryptography`, a KeyError or ValueError on a mangled table.
        raise UnreadablePdfError(pdf.name) from exc
    if formula and plan.pipeline == "classic" and not plan.formula:
        plan = replace(plan, formula=True, reason=f"{plan.reason} + formulas always on")
    variant = variant_of(plan)
    if plan.pipeline == "vlm" and not cuda_available():
        # granite-docling generates DocTags autoregressively, thousands of
        # tokens a page, each one a full forward pass. Measured without CUDA:
        # over 56 s/page against 0.9 s/page for the classic pipeline. Warn
        # rather than refuse — the run is valid, just far too slow to iterate on.
        logger.warning("%s: no CUDA device, vlm will take minutes per page", pdf.name)
    if variant not in converters:
        converters[variant] = build_converter(plan.pipeline, ocr=plan.ocr, formula=plan.formula)

    started = time.perf_counter()
    try:
        result = converters[variant].convert(pdf)
    except ConversionError as exc:
        raise UnreadablePdfError(pdf.name) from exc
    elapsed = time.perf_counter() - started
    if result.status != ConversionStatus.SUCCESS:
        raise IncompletePdfError(f"{pdf.name}: conversion {result.status}")
    meta = ParsedMeta(
        source_file=source_file,
        source_path=str(pdf.resolve()),
        source_sha256=sha256_of(pdf),
        parse_variant=variant,
        docling_version=docling_version(),
        course=course,
        academic_year=academic_year,
        seconds=round(elapsed, 1),
        parsed_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    return ParsedPdf(document=result.document, meta=meta, plan=plan)


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
        required=True,
        help="the edition's course code, carried into every chunk payload",
    )
    parser.add_argument(
        "--academic-year",
        required=True,
        help="the edition's academic year (YYYY-YYYY), carried into every chunk payload",
    )
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    manual = args.profile == "manual"
    if not manual and (args.pipeline or args.ocr or args.formula):
        parser.error("--pipeline/--ocr/--formula require --profile manual")
    if manual and (args.ocr or args.formula) and (args.pipeline or "classic") != "classic":
        parser.error("--ocr and --formula apply to the classic pipeline only")

    # Function-level import: `rag.chunk` imports this module, so a module-level
    # import here would be circular.
    from rag.chunk import edition_of

    try:
        edition_of(args.course, args.academic_year)
    except ValueError as exc:
        parser.error(str(exc))

    configure_cli_logging()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # One converter per distinct configuration, not per file: rebuilding it would
    # reload the layout and table models for every deck in the directory.
    converters: dict[str, DocumentConverter] = {}

    manual_plan = (
        ParsePlan(
            pipeline=args.pipeline or "classic", ocr=args.ocr, formula=args.formula, reason="manual"
        )
        if manual
        else None
    )
    pdfs = list(collect_pdfs(args.target))
    failed = 0
    for pdf in pdfs:
        try:
            parsed = parse_pdf(
                pdf,
                course=args.course,
                academic_year=args.academic_year,
                source_file=pdf.name,
                converters=converters,
                plan=manual_plan,
            )
            doc_path, _ = persist(parsed.document, parsed.meta, args.out_dir)
        except Exception:
            # A parse crash on one deck must not lose the rest of an hour-long run.
            logger.exception("%s: parse failed", pdf.name)
            failed += 1
            continue

        logger.info(
            # ASCII only: the Windows console codepage mangles anything else.
            "%s: %s (%s) - %.1fs, %d items -> %s",
            pdf.name,
            parsed.meta.parse_variant,
            parsed.plan.reason,
            parsed.meta.seconds,
            len(parsed.document.texts),
            doc_path,
        )

    # The summary is the command's product: how much of the corpus is now on disk.
    print(f"parsed {len(pdfs) - failed}/{len(pdfs)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
