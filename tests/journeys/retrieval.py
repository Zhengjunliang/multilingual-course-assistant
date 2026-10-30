"""The journeys' retrieval (`QA_RETRIEVAL` in tests/journeys/settings.py): the
stub encoders of tests/test_index.py over an in-memory index holding one slides
excerpt and one web page, so a student is answered from the page and from
whatever of the slides their scope reads (apps/qa/scope.py), and an anonymous
visitor, whose scope holds no edition, from the page alone.

The index is the run's one, which the journeys' ingest writes into too
(tests/journeys/ingest.py), so a file uploaded in a journey is among the next
answer's sources. Both run on the worker of tests/journeys/serve.py, one task
at a time.

No model loads and the developer's Qdrant is never opened: what the journeys
check is that the two sides of `/api/ask` agree, not what retrieval finds.
"""

from functools import cache

from qdrant_client import QdrantClient

from apps.qa.engine import Retrieval
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks
from tests.journeys.fake_llm import PAGE
from tests.test_index import StubDense, StubSparse, make_chunk, make_web_chunk


@cache
def index() -> QdrantClient:
    """The run's index, with its two excerpts, built when first asked for."""
    client = QdrantClient(location=":memory:")
    dense, sparse = StubDense(), StubSparse()
    ensure_collection(client, dense.dimension())
    ensure_collection(client, dense.dimension(), WEB_COLLECTION)
    index_chunks(client, [make_chunk()], dense, sparse)
    index_chunks(client, [make_web_chunk("cd" * 32, "crawl", PAGE)], dense, sparse, WEB_COLLECTION)
    return client


def build_retrieval() -> Retrieval:
    return Retrieval(client=index(), dense=StubDense(), sparse=StubSparse(), reranker=None)
