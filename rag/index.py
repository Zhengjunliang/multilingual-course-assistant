"""Step 3 of the ingest pipeline: chunk JSONL -> Qdrant hybrid index.

Consumes the JSONL files written by `rag.chunk` and upserts every chunk into a
Qdrant collection (the compose service by default, `open_client`) with two
named vectors: `dense` (Qwen3-Embedding over `embed_text`) and `sparse` (BM25
over raw `text`). The full `Chunk` payload rides along so retrieval can filter
and cite without ever reopening the source artifacts.

A directory holds the whole set of files of each edition it contains: indexing
a directory also drops, within those editions, the points of files that left
it. A single file never deletes another file's points.

    uv run python -m rag.index data/chunks
    uv run python -m rag.index "data/chunks/<deck>.classic.jsonl"
"""

from __future__ import annotations

import argparse
import logging
import re
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

from rag.chunk import Chunk, EditionKey
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping, Sequence

    from qdrant_client import QdrantClient
    from qdrant_client import models as qmodels

logger = logging.getLogger(__name__)

COLLECTION = "slides"
WEB_COLLECTION = "unifi_web"
DENSE_VECTOR = "dense"
SPARSE_VECTOR = "sparse"

DEFAULT_DENSE_MODEL = "Qwen/Qwen3-Embedding-0.6B"

# A location that starts with one of these is the Qdrant server; config/env.py
# holds QDRANT_URL to the same test.
SERVER_SCHEMES = ("http://", "https://")
# "localhost:6333" or "127.0.0.1:6333/": a server URL that lost its scheme,
# never a directory name. A drive letter ("C:/x") has no digits after its colon.
_HOST_PORT = re.compile(r"[\w.-]+:\d+(?:/.*)?")

# Every field a filter in rag/ reads (rag/search.py payload_filter, and the
# deletes and counts below). A server needs a keyword index on each to plan a
# filtered search; local mode keeps none.
PAYLOAD_INDEXES = (
    "course",
    "academic_year",
    "source_file",
    "url",
    "ingest_source",
    "ingest_run_id",
    "locale",
)

# (indices, values) — the neutral shape both the fastembed encoder and the test
# stubs produce, so nothing outside the builders imports fastembed types.
SparseVector = tuple[list[int], list[float]]


class DenseEncoder(Protocol):
    def dimension(self) -> int: ...

    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def encode_query(self, text: str) -> list[float]: ...


class SparseEncoder(Protocol):
    def encode_documents(self, texts: Sequence[str]) -> list[SparseVector]: ...

    def encode_query(self, text: str) -> SparseVector: ...


class _QwenDense:
    """Qwen3-Embedding via sentence-transformers. Documents are encoded bare;
    queries get the model's built-in `query` prompt — the asymmetry is part of
    the model contract, not a stylistic choice."""

    def __init__(self, model_name: str, device: str | None = None) -> None:
        from sentence_transformers import SentenceTransformer

        # sentence-transformers has no "auto" sentinel the way docling's
        # AcceleratorOptions does: None means "let the library pick", and the
        # live ingest path passes "cpu" to stay out of the VRAM budget.
        self._model = SentenceTransformer(model_name, device=device)

    def dimension(self) -> int:
        dimension = self._model.get_embedding_dimension()
        if dimension is None:
            raise ValueError("embedding model does not declare a fixed dimension")
        return dimension

    # encode()'s multimodal overloads are partially unknown upstream, which strict
    # mode flags on every call; the text-in/ndarray-out shape used here is stable.
    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]:
        embeddings = self._model.encode(list(texts))  # pyright: ignore[reportUnknownMemberType]
        return cast("list[list[float]]", embeddings.tolist())  # pyright: ignore[reportUnknownMemberType]

    def encode_query(self, text: str) -> list[float]:
        embeddings = self._model.encode([text], prompt_name="query")  # pyright: ignore[reportUnknownMemberType]
        return cast("list[float]", embeddings[0].tolist())  # pyright: ignore[reportUnknownMemberType]


class _Bm25Sparse:
    """fastembed's BM25: term-frequency weights per document, raw term hits per
    query — the IDF half lives in the collection's `modifier=IDF`."""

    def __init__(self) -> None:
        from fastembed import SparseTextEmbedding

        self._model = SparseTextEmbedding("Qdrant/bm25")

    def encode_documents(self, texts: Sequence[str]) -> list[SparseVector]:
        return [
            (embedding.indices.tolist(), embedding.values.tolist())
            for embedding in self._model.embed(list(texts))
        ]

    def encode_query(self, text: str) -> SparseVector:
        (embedding,) = list(self._model.query_embed(text))
        return (embedding.indices.tolist(), embedding.values.tolist())


def build_dense_encoder(
    model_name: str = DEFAULT_DENSE_MODEL, device: str | None = None
) -> DenseEncoder:
    return _QwenDense(model_name, device)


# One instance per (model, device), owned here and nowhere else: the live
# ingest path and the agent's candidate narrowing both want the CPU encoder,
# and a second instance would cost another ~2.4GB of host RAM and a second
# first load. Modules that need a shared encoder ask for it, they never cache
# one of their own (the module boundary rule, docs/architecture.md).
_DENSE_CACHE: dict[tuple[str, str | None], DenseEncoder] = {}


def cached_dense_encoder(
    model_name: str = DEFAULT_DENSE_MODEL, device: str | None = None
) -> DenseEncoder:
    """The shared encoder for that (model, device) pair, loaded on first use.

    Ingest CLIs keep calling `build_dense_encoder` directly: a one-shot process
    that loads one encoder and exits has nothing to share.
    """
    key = (model_name, device)
    encoder = _DENSE_CACHE.get(key)
    if encoder is None:
        encoder = build_dense_encoder(model_name, device)
        _DENSE_CACHE[key] = encoder
    return encoder


def build_sparse_encoder() -> SparseEncoder:
    return _Bm25Sparse()


def qdrant_location(text: str) -> str:
    """`text` unchanged if it can name an index: an http:// or https:// URL, or
    anything else a directory could be called. An empty value, or anything that
    looks like a URL without being one, is an error: neither kind ever falls
    back to the other."""
    if not text.startswith(SERVER_SCHEMES) and (
        not text.strip() or "://" in text or _HOST_PORT.fullmatch(text)
    ):
        raise ValueError(f"not a Qdrant location: {text!r}; pass an http(s) URL or a directory")
    return text


def open_client(location: str | Path | None = None) -> QdrantClient:
    """Open the index at `location`. An http:// or https:// URL is the Qdrant
    server every process shares; any other value is a directory opened as an
    embedded index, which one process holds at a time (the tests, a machine
    without the service). `None` is the server named by QDRANT_URL
    (config/env.py). What `qdrant_location` refuses is an error here too.
    """
    from qdrant_client import QdrantClient

    if location is None:
        from config.env import env

        location = env.qdrant_url
    text = qdrant_location(str(location))
    if text.startswith(SERVER_SCHEMES):
        return QdrantClient(url=text)
    return QdrantClient(path=text)


def add_qdrant_argument(parser: argparse.ArgumentParser) -> None:
    """The one --qdrant of every rag command, read by `open_client`. A value
    that names no index is a usage error while the arguments are parsed, before
    any model loads."""
    parser.add_argument(
        "--qdrant",
        metavar="URL|DIR",
        type=qdrant_location,
        default=None,
        help="the Qdrant server's http(s) URL, or a directory to open as an embedded "
        "index that one process holds at a time (default: QDRANT_URL)",
    )


def point_id_of(chunk_id: str) -> str:
    """Qdrant only accepts int/UUID ids; uuid5 keeps them deterministic so
    re-indexing the same snapshot overwrites instead of duplicating. The
    original chunk_id stays readable in the payload."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_id))


def ensure_collection(
    client: QdrantClient, dense_dimension: int, collection: str = COLLECTION
) -> None:
    from qdrant_client import models

    if not client.collection_exists(collection):
        client.create_collection(
            collection_name=collection,
            vectors_config={
                DENSE_VECTOR: models.VectorParams(
                    size=dense_dimension, distance=models.Distance.COSINE
                )
            },
            sparse_vectors_config={
                SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
            },
        )
    ensure_payload_indexes(client, collection)


def ensure_payload_indexes(client: QdrantClient, collection: str = COLLECTION) -> None:
    """Create the keyword indexes of PAYLOAD_INDEXES that `collection` lacks.
    Idempotent, and it runs on collections that already exist: a collection
    copied from an embedded index (local mode keeps none), or created before a
    field joined PAYLOAD_INDEXES, lacks them.

    An embedded index is skipped: qdrant-client warns that payload indexes have
    no effect there, and does nothing.
    """
    from qdrant_client import models

    options = client.init_options
    if options.get("path") is not None or options.get("location") == ":memory:":
        return
    existing = client.get_collection(collection).payload_schema
    for field in PAYLOAD_INDEXES:
        if field not in existing:
            client.create_payload_index(
                collection, field, field_schema=models.PayloadSchemaType.KEYWORD
            )


def load_chunks(path: Path) -> list[Chunk]:
    return [
        Chunk.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def collect_chunk_files(target: Path) -> Iterator[Path]:
    if target.is_file():
        yield target
        return
    yield from sorted(path for path in target.rglob("*.jsonl") if path.is_file())


def _others_of(must: list[qmodels.Condition], keep: Sequence[str]) -> qmodels.Filter:
    """The points matching every condition of `must`, less the ids in `keep`."""
    from qdrant_client import models

    return models.Filter(
        must=must, must_not=[models.HasIdCondition(has_id=list(keep))] if keep else None
    )


def delete_web_versions(
    client: QdrantClient,
    pairs: Sequence[tuple[str, str]],
    collection: str = COLLECTION,
    *,
    keep: Sequence[str] = (),
) -> None:
    """Scoped replacement for web chunks: delete the points of exactly the
    (url, ingest_source) pair being re-ingested, except the ids in `keep` —
    the ones `index_chunks` has just written. A web chunk_id changes with the
    page's content, so upsert alone would leave the previous version alive;
    and an unscoped delete-by-url would let a live fetch destroy the crawl
    snapshot version — crawl and live never overwrite each other
    (docs/docling-pipeline.md 3.6)."""
    from qdrant_client import models

    for url, source in pairs:
        client.delete(
            collection,
            points_selector=models.FilterSelector(
                filter=_others_of(
                    [
                        models.FieldCondition(key="url", match=models.MatchValue(value=url)),
                        models.FieldCondition(
                            key="ingest_source", match=models.MatchValue(value=source)
                        ),
                    ],
                    keep,
                )
            ),
        )


def replace_slides_sources(
    client: QdrantClient,
    sources: Sequence[tuple[str, EditionKey]],
    keep: Sequence[str],
    collection: str = COLLECTION,
) -> None:
    """After the upsert: delete every other point of one source file in one
    edition, keyed by (source_file, course, academic_year).

    Identity is the source; the sha in `chunk_id` only says whether the content
    changed (LangChain's `source_id_key`). A delete keyed by the new sha would
    miss the points of the old content. No `kind` condition: payloads written
    before `kind` existed lack the key, and a web point's null `academic_year`
    never matches a value.
    """
    from qdrant_client import models

    for source_file, edition in sources:
        client.delete(
            collection,
            points_selector=models.FilterSelector(
                filter=_others_of(
                    [
                        models.FieldCondition(
                            key="source_file", match=models.MatchValue(value=source_file)
                        ),
                        models.FieldCondition(
                            key="course", match=models.MatchValue(value=edition.course)
                        ),
                        models.FieldCondition(
                            key="academic_year",
                            match=models.MatchValue(value=edition.academic_year),
                        ),
                    ],
                    keep,
                )
            ),
        )


def sync_editions(
    client: QdrantClient, seen: Mapping[EditionKey, set[str]], collection: str = COLLECTION
) -> int:
    """After a directory run: for each edition the directory holds, delete the
    points whose source file is no longer in it, and return how many.

    LangChain's `full` cleanup limited to the editions this run saw: another
    edition, and another directory's edition, is never touched. `main` runs it
    only after a directory run with no failed file, since the points of a file
    that failed would look gone. The files and the point count are logged
    before the delete, which takes exactly the ids that were logged.
    """
    from qdrant_client import models

    dropped = 0
    for edition, files in sorted(seen.items()):
        gone = models.Filter(
            must=[
                models.FieldCondition(key="course", match=models.MatchValue(value=edition.course)),
                models.FieldCondition(
                    key="academic_year", match=models.MatchValue(value=edition.academic_year)
                ),
            ],
            must_not=[
                models.FieldCondition(key="source_file", match=models.MatchAny(any=sorted(files)))
            ],
        )
        ids: list[models.ExtendedPointId] = []
        names: set[str] = set()
        offset = None
        while True:
            points, offset = client.scroll(
                collection,
                scroll_filter=gone,
                limit=256,
                offset=offset,
                with_payload=["source_file"],
            )
            ids.extend(point.id for point in points)
            names.update(str((point.payload or {})["source_file"]) for point in points)
            if offset is None:
                break
        if not ids:
            continue
        logger.info(
            "%s:%s: deleting %d points of files no longer in the directory: %s",
            edition.course,
            edition.academic_year,
            len(ids),
            ", ".join(sorted(names)),
        )
        client.delete(collection, points_selector=models.PointIdsList(points=ids))
        dropped += len(ids)
    return dropped


def count_web_versions(
    client: QdrantClient, url: str, source: str, collection: str = COLLECTION
) -> int:
    """How many points the index holds for one (url, ingest_source) pair.

    The live incremental check asks this before believing the ledger that a page
    is unchanged: the registry is append-only, so `delete_by_run` leaves the
    rolled-back run's rows behind, and a matching content_hash on its own would
    skip re-indexing a page whose points are gone.
    """
    from qdrant_client import models

    return client.count(
        collection,
        count_filter=models.Filter(
            must=[
                models.FieldCondition(key="url", match=models.MatchValue(value=url)),
                models.FieldCondition(key="ingest_source", match=models.MatchValue(value=source)),
            ]
        ),
    ).count


def delete_by_run(client: QdrantClient, run_id: str, collection: str = WEB_COLLECTION) -> None:
    """Roll back one live ingest run: every point it wrote, and nothing else.

    The predicate is two conditions, and the second one is hardcoded rather
    than a parameter: crawl chunks carry an `ingest_run_id` too, so a single
    condition plus one mistyped run id would delete a frozen crawl snapshot
    that no rollback can restore. With `ingest_source == "live"` welded into
    the filter, a crawl run id deletes exactly zero points — the eval-isolation
    rule of docs/architecture.md enforced at the predicate, the same reason
    `delete_web_versions` is scoped by pair.
    """
    from qdrant_client import models

    client.delete(
        collection,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="ingest_run_id", match=models.MatchValue(value=run_id)
                    ),
                    models.FieldCondition(
                        key="ingest_source", match=models.MatchValue(value="live")
                    ),
                ]
            )
        ),
    )


def _slides_sources_of(chunks: Sequence[Chunk]) -> set[tuple[str, EditionKey]]:
    """The (source_file, edition) keys a file's slides chunks replace, and a
    directory run syncs by."""
    return {
        (chunk.source_file, EditionKey(chunk.course, chunk.academic_year))
        for chunk in chunks
        if chunk.kind == "slides" and chunk.academic_year is not None
    }


def index_chunks(
    client: QdrantClient,
    chunks: Sequence[Chunk],
    dense: DenseEncoder,
    sparse: SparseEncoder,
    collection: str = COLLECTION,
) -> int:
    """Encode and upsert one document's chunks; `dense` reads `embed_text`
    (heading-contextualized), `sparse` reads raw `text` — the two-sided contract
    set at chunking time. Web chunks replace their own (url, ingest_source)
    predecessors and slides chunks their own (source_file, course,
    academic_year) predecessors, after the upsert, so a document is never
    missing from the index."""
    from qdrant_client import models

    dense_vectors = dense.encode_documents([chunk.embed_text for chunk in chunks])
    sparse_vectors = sparse.encode_documents([chunk.text for chunk in chunks])
    keep = [point_id_of(chunk.chunk_id) for chunk in chunks]
    points = [
        models.PointStruct(
            id=point_id,
            vector={
                DENSE_VECTOR: dense_vector,
                SPARSE_VECTOR: models.SparseVector(indices=indices, values=values),
            },
            payload=chunk.model_dump(),
        )
        for chunk, point_id, dense_vector, (indices, values) in zip(
            chunks, keep, dense_vectors, sparse_vectors, strict=True
        )
    ]
    client.upsert(collection, points)

    web_pairs = sorted(
        {
            (chunk.url, chunk.ingest_source)
            for chunk in chunks
            if chunk.kind == "web" and chunk.url and chunk.ingest_source
        }
    )
    if web_pairs:
        delete_web_versions(client, web_pairs, collection, keep=keep)
    slides_sources = sorted(_slides_sources_of(chunks))
    if slides_sources:
        replace_slides_sources(client, slides_sources, keep, collection)
    return len(points)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a chunk JSONL file, or a directory of them")
    add_qdrant_argument(parser)
    parser.add_argument("--collection", default=COLLECTION)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    args = parser.parse_args(argv)

    configure_cli_logging()

    # Encoders load once for the whole run — the model load dominates, not the upserts.
    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    client = open_client(args.qdrant)
    ensure_collection(client, dense.dimension(), args.collection)

    chunk_files = list(collect_chunk_files(args.target))
    failed = 0
    seen: dict[EditionKey, set[str]] = {}
    for path in chunk_files:
        try:
            chunks = load_chunks(path)
            sources = _slides_sources_of(chunks)
            if any(source in seen.get(edition, set()) for source, edition in sources):
                # Indexing it would silently replace the other file's points.
                logger.error("%s: repeats a source file of another file in this run", path.name)
                failed += 1
                continue
            count = index_chunks(client, chunks, dense, sparse, args.collection)
        except Exception:
            # One bad file must not lose the rest of the corpus run.
            logger.exception("%s: indexing failed", path.name)
            failed += 1
            continue
        for source, edition in sources:
            seen.setdefault(edition, set()).add(source)
        logger.info("%s: %d chunks upserted", path.name, count)

    print(f"indexed {len(chunk_files) - failed}/{len(chunk_files)}")
    # A web directory holds no slides edition, so it has nothing to sync.
    if args.target.is_dir() and seen:
        if failed:
            logger.warning(
                "sync skipped: %d file(s) failed, and their points would look gone", failed
            )
        else:
            dropped = sync_editions(client, seen, args.collection)
            print(f"dropped {dropped} points of files no longer in {args.target}")
    client.close()
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
