"""Step 3 of the ingest pipeline: chunk JSONL -> Qdrant hybrid index.

Consumes the JSONL files written by `rag.chunk` and upserts every chunk into a
local (embedded, serverless) Qdrant collection with two named vectors: `dense`
(Qwen3-Embedding over `embed_text`) and `sparse` (BM25 over raw `text`). The
full `Chunk` payload rides along so retrieval can filter and cite without ever
reopening the source artifacts.

    uv run python -m rag.index data/chunks
    uv run python -m rag.index "data/chunks/<deck>.classic.jsonl"
"""

from __future__ import annotations

import argparse
import logging
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

from rag.chunk import Chunk
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from qdrant_client import QdrantClient

logger = logging.getLogger(__name__)

COLLECTION = "slides"
WEB_COLLECTION = "unifi_web"
DENSE_VECTOR = "dense"
SPARSE_VECTOR = "sparse"

DEFAULT_QDRANT_DIR = Path(__file__).resolve().parent.parent / "data" / "qdrant"
DEFAULT_DENSE_MODEL = "Qwen/Qwen3-Embedding-0.6B"

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
# one of their own (the module boundary rule, docs/architettura.md).
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


def open_client(path: Path = DEFAULT_QDRANT_DIR) -> QdrantClient:
    from qdrant_client import QdrantClient

    return QdrantClient(path=str(path))


def point_id_of(chunk_id: str) -> str:
    """Qdrant only accepts int/UUID ids; uuid5 keeps them deterministic so
    re-indexing the same snapshot overwrites instead of duplicating. The
    original chunk_id stays readable in the payload."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_id))


def ensure_collection(
    client: QdrantClient, dense_dimension: int, collection: str = COLLECTION
) -> None:
    from qdrant_client import models

    if client.collection_exists(collection):
        return
    client.create_collection(
        collection_name=collection,
        vectors_config={
            DENSE_VECTOR: models.VectorParams(size=dense_dimension, distance=models.Distance.COSINE)
        },
        sparse_vectors_config={
            SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
        },
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


def delete_web_versions(
    client: QdrantClient, pairs: Sequence[tuple[str, str]], collection: str = COLLECTION
) -> None:
    """Scoped replacement for web chunks: delete exactly the (url,
    ingest_source) pair being re-ingested. A web chunk_id changes with the
    page's content, so upsert alone would leave the previous version alive;
    and an unscoped delete-by-url would let a live fetch destroy the crawl
    snapshot version — crawl and live never overwrite each other
    (docs/docling-e-pipeline.md 3.6)."""
    from qdrant_client import models

    for url, source in pairs:
        client.delete(
            collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(key="url", match=models.MatchValue(value=url)),
                        models.FieldCondition(
                            key="ingest_source", match=models.MatchValue(value=source)
                        ),
                    ]
                )
            ),
        )


def delete_by_run(client: QdrantClient, run_id: str, collection: str = WEB_COLLECTION) -> None:
    """Roll back one live ingest run: every point it wrote, and nothing else.

    The predicate is two conditions, and the second one is hardcoded rather
    than a parameter: crawl chunks carry an `ingest_run_id` too, so a single
    condition plus one mistyped run id would delete a frozen crawl snapshot
    that no rollback can restore. With `ingest_source == "live"` welded into
    the filter, a crawl run id deletes exactly zero points — ADR-1 ("live never
    touches the crawl snapshot") enforced at the predicate, the same reason
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
    predecessors first; slides chunks rely on deterministic ids alone."""
    from qdrant_client import models

    web_pairs = sorted(
        {
            (chunk.url, chunk.ingest_source)
            for chunk in chunks
            if chunk.kind == "web" and chunk.url and chunk.ingest_source
        }
    )
    if web_pairs:
        delete_web_versions(client, web_pairs, collection)

    dense_vectors = dense.encode_documents([chunk.embed_text for chunk in chunks])
    sparse_vectors = sparse.encode_documents([chunk.text for chunk in chunks])
    points = [
        models.PointStruct(
            id=point_id_of(chunk.chunk_id),
            vector={
                DENSE_VECTOR: dense_vector,
                SPARSE_VECTOR: models.SparseVector(indices=indices, values=values),
            },
            payload=chunk.model_dump(),
        )
        for chunk, dense_vector, (indices, values) in zip(
            chunks, dense_vectors, sparse_vectors, strict=True
        )
    ]
    client.upsert(collection, points)
    return len(points)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="a chunk JSONL file, or a directory of them")
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--collection", default=COLLECTION)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    args = parser.parse_args(argv)

    configure_cli_logging()

    # Encoders load once for the whole run — the model load dominates, not the upserts.
    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    client = open_client(args.qdrant_path)
    ensure_collection(client, dense.dimension(), args.collection)

    chunk_files = list(collect_chunk_files(args.target))
    failed = 0
    for path in chunk_files:
        try:
            count = index_chunks(client, load_chunks(path), dense, sparse, args.collection)
        except Exception:
            # One bad file must not lose the rest of the corpus run.
            logger.exception("%s: indexing failed", path.name)
            failed += 1
            continue
        logger.info("%s: %d chunks upserted", path.name, count)

    client.close()
    print(f"indexed {len(chunk_files) - failed}/{len(chunk_files)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
