"""Step 2 of the ingest pipeline: DoclingDocument JSON -> chunks with payload.

Consumes the artifact pairs written by `rag.parse` (`<stem>.<variant>.json` +
`<stem>.<variant>.meta.json`) and emits one JSONL file of `Chunk` records per
document. Never opens the original PDF and never imports docling: everything a
chunk must carry into the index — business fields and provenance — comes from
the document JSON and the sidecar.

    uv run python -m rag.chunk data/parsed
    uv run python -m rag.chunk "data/parsed/<deck>.classic.json" --max-tokens 256
"""

from __future__ import annotations

import argparse
import logging
import re
from math import ceil
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from rag.parse import ParsedMeta, normalize_text
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from collections.abc import Iterator

    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
    from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer
    from docling_core.types.doc.document import DoclingDocument

logger = logging.getLogger(__name__)

# BCP-47 primary subtag, normalized lowercase (2-3 letters): the corpus is
# en/it today, campus questions add zh, and the web source can surface anything
# — a closed Literal would turn every new language into a ValidationError that
# fails a whole file's ingest.
_LOCALE_PATTERN = r"^[a-z]{2,3}$"
Locale = Annotated[str, StringConstraints(pattern=_LOCALE_PATTERN)]


def locale_arg(value: str) -> str:
    """argparse type for --locale flags: normalize a BCP-47 tag to its primary
    subtag (`it-IT` -> `it`) and reject junk loudly instead of letting a typo
    like `itt` silently filter every result to nothing."""
    subtag = value.strip().lower().replace("_", "-").split("-")[0]
    if not re.fullmatch(_LOCALE_PATTERN, subtag):
        raise argparse.ArgumentTypeError(f"not a BCP-47 primary subtag: {value!r}")
    return subtag


DEFAULT_OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "chunks"

# The chunker must count tokens with the embedding model's own tokenizer: counted
# with any other vocabulary, a chunk that fits on paper overflows the real input
# window and the tail is silently truncated out of the index. 512 is the starting
# chunk budget, an M3 experiment variable — not Qwen3-Embedding's 32k ceiling,
# which is absurd as a retrieval granularity.
DEFAULT_TOKENIZER = "Qwen/Qwen3-Embedding-0.6B"
DEFAULT_MAX_TOKENS = 512

# Function words only: corpus decks are monolingual enough (thousands of tokens,
# 23 EN / 8 IT) that counting stopword hits separates the two languages
# deterministically — a language-detection dependency would be dead weight.
# The sets are disjoint on purpose; words spelled identically in both languages
# (`in`, `a`, `la` the note...) are left out of both.
_EN_STOPWORDS = frozenset(
    (
        "the",
        "of",
        "and",
        "to",
        "is",
        "are",
        "for",
        "with",
        "that",
        "this",
        "on",
        "be",
        "as",
        "by",
        "an",
        "it",
        "from",
        "at",
        "or",
        "which",
        "can",
        "has",
        "have",
        "not",
        "what",
        "when",
        "where",
        "how",
    )
)
_IT_STOPWORDS = frozenset(
    (
        "il",
        "lo",
        "gli",
        "le",
        "di",
        "del",
        "della",
        "delle",
        "dei",
        "che",
        "per",
        "con",
        "non",
        "sono",
        "una",
        "uno",
        "anche",
        "come",
        "più",
        "questo",
        "questa",
        "nel",
        "alla",
        "si",
        "è",
        "ed",
    )
)

_WORD = re.compile(r"[a-zàèéìòù]+")
_CJK = re.compile(r"[㐀-䶿一-鿿]")


def detect_locale(text: str) -> Locale:
    """CJK by character ratio first (stopword voting is structurally blind to
    Chinese — both counts stay zero and the tie falls to `en`), then majority
    vote between the two stopword sets; ties fall to `en`, the majority
    language of the corpus."""
    stripped = "".join(text.split())
    if stripped and len(_CJK.findall(stripped)) / len(stripped) >= 0.2:
        return "zh"
    words = _WORD.findall(text.lower())
    en = sum(1 for word in words if word in _EN_STOPWORDS)
    it = sum(1 for word in words if word in _IT_STOPWORDS)
    return "it" if it > en else "en"


class Chunk(BaseModel):
    """The index payload contract (docs/docling-e-pipeline.md owns the field table).

    `text` is the raw chunk body — the BM25/sparse side and what the user is shown.
    `embed_text` is the heading-contextualized version — the dense side only, so a
    heading chain can help semantic retrieval without polluting lexical matching.
    Provenance fields exist so M3 can attribute every chunk to its parse
    configuration and corpus snapshot; they cannot be backfilled once indexed.
    """

    model_config = ConfigDict(frozen=True)

    chunk_id: str
    chunk_index: int
    text: str
    embed_text: str
    locale: Locale
    course: str
    source_file: str
    page: int
    pages: list[int]
    heading_path: list[str]
    parse_variant: str
    docling_version: str
    source_sha256: str
    # Web-source provenance (M2.5). All optional with defaults so every payload
    # already in the index and every slides chunk stays valid: for slides,
    # `kind` is "slides" and the rest is None — a legal terminal state, not
    # missing data. Replacement granularity for web chunks is the
    # (url, ingest_source) pair: crawl snapshots and live increments never
    # overwrite each other (chunk_id changes with content, deletion is scoped).
    kind: Literal["slides", "web"] = "slides"
    url: str | None = None
    referrer_url: str | None = None
    fetch_date: str | None = None
    section: str | None = None
    ingest_run_id: str | None = None
    ingest_source: Literal["crawl", "live"] | None = None
    trigger: str | None = None
    content_hash: str | None = None


def furniture_threshold(num_pages: int) -> int:
    """A heading repeated on this many distinct pages is page furniture.

    Corpus evidence: the repeated page header `HTML &amp; CSS` shows up on 21/32
    and 32/32 pages of the decks it pollutes, while genuine sections span 2-4
    consecutive slides. 20% of the document with a floor of 5 separates the two
    with a wide margin either side.
    """
    return max(5, ceil(num_pages / 5))


def furniture_headings(document: DoclingDocument) -> set[str]:
    """Heading texts that repeat across enough pages to be headers, not structure."""
    from docling_core.types.doc.items.text import SectionHeaderItem, TitleItem

    pages_of: dict[str, set[int]] = {}
    max_page = 0
    for item in document.texts:
        for prov in item.prov:
            max_page = max(max_page, prov.page_no)
        if isinstance(item, SectionHeaderItem | TitleItem):
            for prov in item.prov:
                pages_of.setdefault(item.text, set()).add(prov.page_no)

    num_pages = len(document.pages) or max_page
    threshold = furniture_threshold(num_pages)
    return {text for text, pages in pages_of.items() if len(pages) >= threshold}


def chunk_document(
    document: DoclingDocument, chunker: HybridChunker, meta: ParsedMeta, locale: Locale
) -> list[Chunk]:
    """Chunk one document and attach the full payload to every chunk.

    Furniture headings are removed from `chunk.meta.headings` *before*
    `contextualize()`, so they disappear from both `heading_path` and
    `embed_text` in one move; the document structure itself is untouched.
    NFKC folding happens here, not at parse time: the document JSON keeps the
    original text, the index only ever sees folded text.
    """
    from docling_core.transforms.chunker.doc_chunk import DocMeta

    furniture = furniture_headings(document)
    chunks: list[Chunk] = []
    for index, chunk in enumerate(chunker.chunk(document)):
        if not isinstance(chunk.meta, DocMeta):  # pragma: no cover - HybridChunker emits DocMeta
            raise TypeError(f"expected DocMeta, got {type(chunk.meta).__name__}")
        if chunk.meta.headings:
            chunk.meta.headings = [h for h in chunk.meta.headings if h not in furniture] or None

        pages = sorted({prov.page_no for item in chunk.meta.doc_items for prov in item.prov})
        chunks.append(
            Chunk(
                # Deterministic across re-runs of the same corpus snapshot + parse
                # configuration, so re-indexing overwrites instead of duplicating.
                chunk_id=f"{meta.source_sha256[:16]}:{meta.parse_variant}:{index:04d}",
                chunk_index=index,
                text=normalize_text(chunk.text),
                embed_text=normalize_text(chunker.contextualize(chunk)),
                locale=locale,
                course=meta.course,
                source_file=meta.source_file,
                page=pages[0] if pages else 1,
                pages=pages,
                heading_path=[normalize_text(h) for h in chunk.meta.headings or []],
                parse_variant=meta.parse_variant,
                docling_version=meta.docling_version,
                source_sha256=meta.source_sha256,
                kind=meta.kind,
                url=meta.url,
                referrer_url=meta.referrer_url,
                fetch_date=meta.fetch_date,
                section=meta.section,
                ingest_run_id=meta.ingest_run_id,
                ingest_source=meta.ingest_source,
                trigger=meta.trigger,
                content_hash=meta.content_hash,
            )
        )
    return chunks


def build_tokenizer(model_name: str, max_tokens: int) -> BaseTokenizer:
    """`max_tokens` is always passed explicitly: omitting it makes the wrapper
    fall back to a hub config download, and the embedding model's native limit
    is not a chunk size anyway. Passing a raw transformers tokenizer instead of
    the wrapper is deprecated upstream — never do it."""
    from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer

    # PathLike is unparameterized upstream, which strict mode flags on every call.
    return HuggingFaceTokenizer.from_pretrained(  # pyright: ignore[reportUnknownMemberType]
        model_name, max_tokens=max_tokens
    )


def build_chunker(tokenizer: BaseTokenizer) -> HybridChunker:
    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker

    return HybridChunker(tokenizer=tokenizer)


def meta_path_of(doc_path: Path) -> Path:
    return doc_path.with_name(doc_path.name.removesuffix(".json") + ".meta.json")


def collect_documents(target: Path) -> Iterator[Path]:
    """A directory scan only yields JSONs whose sidecar sits next to them.

    `persist()` always writes the pair together, so a lone `.json` under the
    parsed dir is not our artifact (state files from other tools have shown up
    there) — skip it with a warning instead of failing the corpus run. An
    explicitly named file bypasses the filter so a genuinely missing sidecar
    still surfaces as a hard error.
    """
    if target.is_file():
        yield target
        return
    for path in sorted(target.rglob("*.json")):
        if not path.is_file() or path.name.endswith(".meta.json"):
            continue
        if not meta_path_of(path).exists():
            logger.warning("%s: no meta sidecar, skipping", path.name)
            continue
        yield path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a document JSON, or a directory of them")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--tokenizer", default=DEFAULT_TOKENIZER)
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument(
        "--locale",
        type=lambda value: value if value == "auto" else locale_arg(value),
        default="auto",
        help="auto: sidecar lang, else stopword/CJK heuristic per document; "
        "a BCP-47 primary subtag (en/it/zh/...) forces it for every file",
    )
    args = parser.parse_args(argv)

    configure_cli_logging()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # One tokenizer and one chunker for the whole run: the tokenizer load (and
    # first-run download) is the only expensive part of this step.
    chunker = build_chunker(build_tokenizer(args.tokenizer, args.max_tokens))

    from docling_core.types.doc.document import DoclingDocument

    doc_paths = list(collect_documents(args.target))
    failed = 0
    for doc_path in doc_paths:
        try:
            meta = ParsedMeta.model_validate_json(
                meta_path_of(doc_path).read_text(encoding="utf-8")
            )
            document = DoclingDocument.load_from_json(doc_path)
            if args.locale != "auto":
                locale = args.locale
            elif meta.lang:
                # The web parser records <html lang>; a declared language beats
                # the stopword/CJK guess.
                locale = meta.lang
            else:
                locale = detect_locale("\n".join(item.text for item in document.texts))
            chunks = chunk_document(document, chunker, meta, locale)
        except Exception:
            # One bad artifact must not lose the rest of the corpus run.
            logger.exception("%s: chunking failed", doc_path.name)
            failed += 1
            continue

        target = args.out_dir / f"{doc_path.name.removesuffix('.json')}.jsonl"
        target.write_text(
            "".join(chunk.model_dump_json() + "\n" for chunk in chunks), encoding="utf-8"
        )
        logger.info(
            # ASCII only: the Windows console codepage mangles anything else.
            "%s: %d chunks (%s) -> %s",
            doc_path.name,
            len(chunks),
            locale,
            target,
        )

    print(f"chunked {len(doc_paths) - failed}/{len(doc_paths)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
