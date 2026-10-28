"""The journeys' retrieval (`QA_RETRIEVAL` in tests/journeys/settings.py): the
stub encoders of tests/test_index.py over an in-memory index holding one slides
excerpt and one web page, so a student, whose scope is every edition, is
answered from both, and an anonymous visitor, whose scope is none, from the page.

No model loads and the developer's Qdrant is never opened: what the journeys
check is that the two sides of `/api/ask` agree, not what retrieval finds.
"""

from qdrant_client import QdrantClient

from apps.qa.engine import Retrieval
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks
from tests.journeys.fake_llm import PAGE
from tests.test_index import StubDense, StubSparse, make_chunk, make_web_chunk


def build_retrieval() -> Retrieval:
    client = QdrantClient(location=":memory:")
    dense, sparse = StubDense(), StubSparse()
    ensure_collection(client, dense.dimension())
    ensure_collection(client, dense.dimension(), WEB_COLLECTION)
    index_chunks(client, [make_chunk()], dense, sparse)
    index_chunks(client, [make_web_chunk("cd" * 32, "crawl", PAGE)], dense, sparse, WEB_COLLECTION)
    return Retrieval(client=client, dense=dense, sparse=sparse, reranker=None)
