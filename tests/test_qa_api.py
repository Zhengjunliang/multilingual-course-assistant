"""The question endpoint, driven end to end without a GPU or a network.

Stub encoders and an embedded Qdrant under tmp_path stand in for the real
models and store — the same substitution `tests/test_index.py` and
`tests/test_search.py` make — so these tests exercise the actual routing,
retrieval and citation code rather than a mock of it. Only the two LLM roles
are scripted, because a canned router reply is what makes a routing assertion
mean anything.

No `django_db` marker anywhere, deliberately. Answering a question touches no
model: the throttle reads `request.user`, but an anonymous request carries no
session cookie and Django hands back `AnonymousUser` without a query. Leaving
the marker off keeps the file runnable with no database at all *and* makes it
strict — the day this path grows a query, these tests fail loudly instead of
silently acquiring a dependency.
"""

import threading
import time
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from django.core.cache import cache
from openai import APIConnectionError, NotFoundError
from qdrant_client import QdrantClient
from rest_framework.test import APIClient
from test_agent import ScriptedCompleter
from test_index import StubDense, StubSparse, make_chunk

from apps.qa import engine as engine_module
from apps.qa import views as views_module
from apps.qa.contract import AskResponse
from apps.qa.engine import Engine
from apps.qa.serializers import MAX_QUESTION_CHARS
from rag import index as rag_index
from rag import search as rag_search
from rag.agent import RouteDecision
from rag.chunk import Chunk
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.llm import Message

ASK_URL = "/api/ask"

ORM_TEXT = "An ORM maps objects to database tables."
TASSE_TEXT = "Le tasse universitarie scadono il 30 novembre."
TASSE_URL = "https://www.unifi.it/it/tasse-e-agevolazioni"
FETCH_DATE = "2026-08-01"

SLIDES_MARKER = "[deck.pdf p.1]"
WEB_MARKER = f"[{TASSE_URL} · {FETCH_DATE}]"

SLIDES_ROUTE = '{"target": "slides", "query": "orm", "fresh": false, "reason": "course material"}'
WEB_ROUTE = '{"target": "unifi_web", "query": "tasse", "fresh": false, "reason": "administrative"}'
# What `route` falls back to whenever the router's reply cannot be parsed, which
# rag/agent.py calls an expected event for a 4B model rather than an exception.
BOTH_ROUTE = '{"target": "both", "query": "orm", "fresh": false, "reason": "unsure"}'


def make_web_chunk() -> Chunk:
    return make_chunk(0, TASSE_TEXT, "it").model_copy(
        update={
            "kind": "web",
            "url": TASSE_URL,
            "fetch_date": FETCH_DATE,
            "ingest_source": "crawl",
        }
    )


class ScriptedStreamer:
    """Generation, as a fixed token sequence. What it yields decides whether a
    marker turns up verbatim in the answer, which is the whole point of the
    `cited` flag."""

    def __init__(self, tokens: Sequence[str]) -> None:
        self.tokens = list(tokens)

    def stream(self, messages: Sequence[Message]) -> Iterator[str]:
        yield from self.tokens


GENERATION_URL = "http://localhost:11434/v1/chat/completions"


class DeadStreamer:
    """A generation endpoint that is not there. Unlike the router's completer,
    the streaming path raises rather than degrading, so the endpoint has to
    catch it — this is what proves it does."""

    def stream(self, messages: Sequence[Message]) -> Iterator[str]:
        raise APIConnectionError(request=httpx.Request("POST", GENERATION_URL))


class RefusingCompleter:
    """A model server that answers, with a refusal.

    Not a connection error: `complete_json` absorbs those into the `both`
    fallback all by itself, so only a *status* error reaches the endpoint. This
    is the first-run mistake — `LLM_MODEL` naming a model nobody pulled — and
    Ollama replies 404 to it.
    """

    def complete(self, messages: Sequence[Message]) -> str:
        request = httpx.Request("POST", GENERATION_URL)
        raise NotFoundError(
            "model 'qwen3:4b' not found",
            response=httpx.Response(404, request=request),
            body=None,
        )


class CountingEngine:
    """An engine that records whether two answers were ever in flight at once.

    It sleeps rather than returning instantly on purpose: with no work inside
    the critical section, threads would serialise by accident and the test
    would pass against a missing lock.
    """

    def __init__(self) -> None:
        self.guard = threading.Lock()
        self.inside = 0
        self.peak_concurrency = 0
        self.calls = 0

    def ask(self, question: str, locale: str | None = None) -> AskResponse:
        with self.guard:
            self.inside += 1
            self.calls += 1
            self.peak_concurrency = max(self.peak_concurrency, self.inside)
        time.sleep(0.02)
        with self.guard:
            self.inside -= 1
        return AskResponse(
            question=question,
            locale=locale or "en",
            answer="",
            route=RouteDecision.model_validate_json(SLIDES_ROUTE),
            citations=[],
        )


@pytest.fixture(autouse=True)
def _fresh_process_state() -> Iterator[None]:
    """The engine slot and the throttle counters are process-wide on purpose
    (apps/qa/engine.py); tests must not inherit one another's stub engine or
    request count."""
    engine_module._HOLDER.engine = None
    cache.clear()
    yield
    engine_module._HOLDER.engine = None
    cache.clear()


@pytest.fixture
def index(tmp_path: Path) -> Iterator[QdrantClient]:
    """Both collections, one chunk each, so a routing decision is observable in
    which excerpt comes back."""
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    ensure_collection(qdrant, StubDense().dimension(), collection=WEB_COLLECTION)
    index_chunks(qdrant, [make_web_chunk()], StubDense(), StubSparse(), WEB_COLLECTION)
    yield qdrant
    qdrant.close()


def install_engine(
    client: QdrantClient, route_reply: str, tokens: Sequence[str] = ("An answer.",)
) -> Engine:
    """Put a fully stubbed engine in the process slot, so the view never builds
    the real one."""
    engine = Engine(
        client=client,
        dense=StubDense(),
        sparse=StubSparse(),
        # No reranker: fusion order is deterministic, a 0.6B causal LM is not
        # something a test may load.
        reranker=None,
        completer=ScriptedCompleter([route_reply]),
        streamer=ScriptedStreamer(tokens),
    )
    engine_module._HOLDER.engine = engine
    return engine


def ask(question: str = "What is an ORM?", forwarded_for: str | None = None, **extra: object):
    """One POST. Return type left to inference on purpose: what the test client
    hands back is Django's response wrapper, not the `Response` the view built,
    and naming it here would be naming an implementation detail of the stubs."""
    # WSGI META rather than the `headers=` kwarg: that one reaches the test
    # client through DRF's `**extra` too, and this spelling is the one the
    # throttle actually reads (`request.META["HTTP_X_FORWARDED_FOR"]`).
    meta: dict[str, Any] = {"HTTP_X_FORWARDED_FOR": forwarded_for} if forwarded_for else {}
    return APIClient().post(ASK_URL, {"question": question, **extra}, format="json", **meta)


def test_a_question_is_answered_from_the_index(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An ORM maps objects ", SLIDES_MARKER])
    response = ask()
    assert response.status_code == 200
    body = response.json()
    assert body["question"] == "What is an ORM?"
    assert body["answer"] == f"An ORM maps objects {SLIDES_MARKER}"
    assert body["citations"][0]["text"] == ORM_TEXT


def test_the_router_decision_reaches_the_response(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    body = ask("Quando scadono le tasse?").json()
    assert body["route"] == {
        "target": "unifi_web",
        "query": "tasse",
        "fresh": False,
        "reason": "administrative",
    }
    assert [citation["text"] for citation in body["citations"]] == [TASSE_TEXT]


def test_a_web_citation_carries_the_page_a_student_can_open(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    citation = ask("Quando scadono le tasse?").json()["citations"][0]
    assert citation["marker"] == WEB_MARKER
    assert citation["kind"] == "web"
    assert citation["url"] == TASSE_URL
    assert citation["fetch_date"] == FETCH_DATE


def test_a_slides_citation_cites_the_file_and_page(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE)
    citation = ask().json()["citations"][0]
    assert citation["marker"] == SLIDES_MARKER
    assert citation["kind"] == "slides"
    assert citation["url"] is None
    assert citation["fetch_date"] is None


def test_only_a_verbatim_marker_counts_as_cited(index: QdrantClient) -> None:
    """A shortened marker is exactly the failure the generation prompt fights;
    `cited` must report it as absent rather than guess the intent."""
    install_engine(index, SLIDES_ROUTE, ["An ORM maps objects ", SLIDES_MARKER])
    assert ask().json()["citations"][0]["cited"] is True

    install_engine(index, SLIDES_ROUTE, ["An ORM maps objects ", "[deck.pdf]"])
    assert ask().json()["citations"][0]["cited"] is False


def test_a_blank_question_is_rejected(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE)
    response = ask("   ")
    assert response.status_code == 400
    assert "question" in response.json()


def test_a_question_over_the_length_cap_is_rejected(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE)
    response = ask("a" * (MAX_QUESTION_CHARS + 1))
    assert response.status_code == 400
    assert "question" in response.json()


def test_a_regional_locale_tag_is_normalised(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    response = ask("Quando scadono le tasse?", locale="it-IT")
    assert response.status_code == 200
    assert response.json()["locale"] == "it"


def test_an_omitted_locale_is_detected_from_the_question(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    assert ask("Quando scadono le tasse universitarie?").json()["locale"] == "it"


def test_an_explicit_null_locale_means_detect_it(index: QdrantClient) -> None:
    """`allow_null` is what separates "decide for me" from "" — a client that
    has no preference sends null rather than omitting the key."""
    install_engine(index, WEB_ROUTE)
    response = ask("Quando scadono le tasse universitarie?", locale=None)
    assert response.status_code == 200
    assert response.json()["locale"] == "it"


def test_a_blank_locale_is_rejected_rather_than_defaulted(index: QdrantClient) -> None:
    """The other half of that pair: an empty string is not a way of saying
    "decide for me", it is a client sending a field it failed to fill in."""
    install_engine(index, SLIDES_ROUTE)
    response = ask(locale="")
    assert response.status_code == 400
    assert "locale" in response.json()


def test_a_locale_that_is_not_a_subtag_is_rejected(index: QdrantClient) -> None:
    """`english` is a language name, not a tag; passing it through would filter
    every result away and read as an empty corpus."""
    install_engine(index, SLIDES_ROUTE)
    response = ask(locale="english")
    assert response.status_code == 400
    assert "locale" in response.json()


def test_a_dead_generation_endpoint_becomes_503(index: QdrantClient) -> None:
    engine = install_engine(index, SLIDES_ROUTE)
    engine_module._HOLDER.engine = Engine(
        client=engine.client,
        dense=engine.dense,
        sparse=engine.sparse,
        reranker=None,
        completer=ScriptedCompleter([SLIDES_ROUTE]),
        streamer=DeadStreamer(),
    )
    response = ask()
    assert response.status_code == 503
    assert "model server" in response.json()["detail"]


def test_an_unbuilt_index_becomes_503(tmp_path: Path) -> None:
    """A fresh checkout has no collection; the answer is a remedy, not a 500."""
    empty = open_client(tmp_path / "empty")
    install_engine(empty, SLIDES_ROUTE)
    response = ask()
    empty.close()
    assert response.status_code == 503
    assert "rag.index" in response.json()["detail"]


# Verbatim from qdrant-client, reproduced by opening one embedded client on a
# directory another already holds — which is exactly what a `rag.index` running
# in a terminal does to the site. Injected rather than staged for real, because
# a client whose constructor raises never closes its lock file, and the
# ResourceWarning that leaks from it fails whichever test the GC happens to
# reach it in (`filterwarnings = ["error"]`). The leak is upstream's; loosening
# the warning gate for the whole suite to accommodate it is the worse trade.
HELD_INDEX_ERROR = (
    "Storage folder data/qdrant is already accessed by another instance of "
    "Qdrant client. If you require concurrent access, use Qdrant server instead."
)


def test_an_index_held_by_another_process_becomes_503(monkeypatch: pytest.MonkeyPatch) -> None:
    """The everyday conflict, and the only route into `build_engine`'s error
    branch: the autouse fixture leaves the slot empty, so the view really does
    try to build an engine here."""

    def refuse(path: Path) -> QdrantClient:
        raise RuntimeError(HELD_INDEX_ERROR)

    monkeypatch.setattr(rag_index, "open_client", refuse)

    response = ask()

    assert response.status_code == 503
    assert "another process" in response.json()["detail"]


def test_a_router_the_server_refuses_becomes_503(index: QdrantClient) -> None:
    """The first-run mistake — the model was never pulled — reaches routing
    before generation, so guarding only the generation call would leave it a
    500 that blames this code for the server's answer."""
    engine = install_engine(index, SLIDES_ROUTE)
    engine_module._HOLDER.engine = Engine(
        client=engine.client,
        dense=engine.dense,
        sparse=engine.sparse,
        reranker=None,
        completer=RefusingCompleter(),
        streamer=ScriptedStreamer(["unreachable"]),
    )
    response = ask()
    assert response.status_code == 503
    assert "model server" in response.json()["detail"]


def test_a_both_route_survives_a_collection_the_index_never_built(tmp_path: Path) -> None:
    """`both` is what the router falls back to on an unusable reply, and a
    fresh checkout has only `slides` — `rag.index` builds that one by default.
    Refusing the whole question there would fail it on the collection that was
    never needed."""
    slides_only = open_client(tmp_path / "slides-only")
    ensure_collection(slides_only, StubDense().dimension())
    index_chunks(slides_only, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    install_engine(slides_only, BOTH_ROUTE)

    body = ask().json()
    slides_only.close()

    assert [citation["text"] for citation in body["citations"]] == [ORM_TEXT]


def test_a_failed_build_releases_the_index_and_is_not_cached(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A build that dies after opening the index — a first-run model download,
    an out-of-memory card — must not strand the directory lock.

    Left held, it would be this process colliding with itself on every later
    request, under a message telling the caller to stop a terminal command that
    was never running. Reopening the same path is what proves it was released.
    """
    path = tmp_path / "qdrant"
    monkeypatch.setattr(rag_index, "DEFAULT_QDRANT_DIR", path)
    monkeypatch.setattr(rag_index, "cached_dense_encoder", lambda *_, **__: StubDense())
    monkeypatch.setattr(rag_index, "build_sparse_encoder", StubSparse)

    def explode(model_name: str) -> object:
        raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(rag_search, "build_reranker", explode)

    response = ask()

    assert response.status_code == 503
    assert engine_module._HOLDER.engine is None
    # Raises if the failed build kept the lock.
    reopened = open_client(path)
    reopened.close()


def test_the_anonymous_rate_limit_returns_429(index: QdrantClient) -> None:
    """Answers are serialised on one GPU, so a burst has to be refused rather
    than queued into a timeout."""
    codes = []
    for _ in range(11):
        install_engine(index, SLIDES_ROUTE, ["ok"])
        codes.append(ask().status_code)
    assert codes[:10] == [200] * 10
    assert codes[10] == 429


def test_a_forwarded_header_cannot_buy_a_fresh_rate_limit_bucket(index: QdrantClient) -> None:
    """DRF's default is to take the throttle identity from a client-supplied
    X-Forwarded-For, which would make the limit above a suggestion: one header
    per request and every request is a new client. Nothing proxies this
    service, so the identity has to stay REMOTE_ADDR."""
    codes = []
    for attempt in range(11):
        install_engine(index, SLIDES_ROUTE, ["ok"])
        codes.append(ask(forwarded_for=f"10.0.0.{attempt}").status_code)
    assert codes[10] == 429


def test_a_queue_deeper_than_the_wait_is_refused_with_a_retry_hint(
    index: QdrantClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rate limit is per client address; the queue is per process. Waiting
    without a ceiling turns a burst into sockets held until the worker dies,
    which reaches the caller as a dropped connection rather than an answer."""
    install_engine(index, SLIDES_ROUTE)
    monkeypatch.setattr(engine_module, "QUEUE_TIMEOUT_SECONDS", 0.05)

    engine_module._HOLDER.lock.acquire()
    try:
        response = ask()
    finally:
        engine_module._HOLDER.lock.release()

    assert response.status_code == 503
    assert response.headers["Retry-After"] == str(views_module.RETRY_AFTER_SECONDS)


def test_two_chunks_of_one_page_stay_two_citations(tmp_path: Path) -> None:
    """The contract says the grounding set is not deduplicated. Two chunks of
    one page share a marker but carry different text, and merging them would
    drop an excerpt the reader was answered from."""
    qdrant = open_client(tmp_path / "one-page")
    ensure_collection(qdrant, StubDense().dimension())
    first = make_chunk(0, ORM_TEXT)
    second = make_chunk(1, "An ORM also generates the schema.").model_copy(
        update={"page": first.page, "pages": list(first.pages)}
    )
    index_chunks(qdrant, [first, second], StubDense(), StubSparse())
    install_engine(qdrant, SLIDES_ROUTE)

    citations = ask().json()["citations"]
    qdrant.close()

    assert len(citations) == 2
    assert {citation["marker"] for citation in citations} == {SLIDES_MARKER}
    assert {citation["text"] for citation in citations} == {first.text, second.text}


def test_answers_never_overlap() -> None:
    """The serialisation is the whole design — one card, one embedded index —
    and nothing else in this file would notice if the lock were deleted.

    Driven through `answer_question` rather than HTTP: the claim is about the
    module's own guard, and threads plus a test database would only add noise.
    """
    engine = CountingEngine()
    engine_module._HOLDER.engine = cast("Engine", engine)

    threads = [
        threading.Thread(target=engine_module.answer_question, args=("What is an ORM?",))
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert engine.calls == 4
    assert engine.peak_concurrency == 1


def test_two_first_requests_build_one_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """The lock covers the build, not only the call: two requests arriving
    before anything is loaded must not each pay for a reranker."""
    builds: list[int] = []

    def slow_build() -> Engine:
        builds.append(1)
        time.sleep(0.05)
        return cast("Engine", CountingEngine())

    monkeypatch.setattr(engine_module, "build_engine", slow_build)

    threads = [
        threading.Thread(target=engine_module.answer_question, args=("What is an ORM?",))
        for _ in range(3)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(builds) == 1
