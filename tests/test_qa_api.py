"""The question endpoint, driven end to end without a GPU or a network.

Stub encoders and an embedded Qdrant under tmp_path stand in for the real
models and store — the same substitution `tests/test_index.py` and
`tests/test_search.py` make — so these tests exercise the actual routing,
retrieval and citation code rather than a mock of it. Only the two LLM roles
are scripted, because a canned router reply is what makes a routing assertion
mean anything.

The endpoint answers with server-sent events, which changes one habit: a
successful response arrives as an unread iterator. Django's test client emulates
a WSGI server here and calls `close()` only when that iterator runs out
(`closing_iterator_wrapper`), and closing is what releases the engine's queue
lock — so a test that looks at a 200 and walks away leaves the lock held for the
next one. Every test below either reads the stream through `events` or closes
the response through `finish`.

This file used to promise that answering a question touched no model, and the
conversation stage is what ended that: the endpoint now writes the question and
the answer as it goes. The promise moved rather than disappeared — it is
`tests/test_qa_engine.py`, which drives the engine directly and carries no
marker, so the layer that must stay query-free still fails loudly if it stops
being.

Sessions are not exercised here either. `force_authenticate` replaces
authentication wholesale, so a test of what `SessionAuthentication` enforces
would be testing nothing; CSRF, cookies and login live in
tests/test_accounts_api.py against a real one.
"""

import json
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import httpx
import pytest
from django.core.cache import cache
from django.core.signals import request_finished
from django.db import close_old_connections
from openai import APIConnectionError, NotFoundError
from qdrant_client import QdrantClient
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from test_agent import ScriptedCompleter
from test_index import StubDense, StubSparse, make_chunk

from apps.accounts.models import User
from apps.qa import engine as engine_module
from apps.qa import views as views_module
from apps.qa.engine import Engine
from apps.qa.models import HISTORY_WINDOW_TURNS, Conversation, Message
from apps.qa.serializers import MAX_QUESTION_CHARS
from rag import index as rag_index
from rag import search as rag_search
from rag.chunk import Chunk
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.llm import Message as ChatMessage

pytestmark = pytest.mark.django_db

ASK_URL = "/api/ask"
CONVERSATIONS_URL = "/api/conversations"
SSE_MEDIA_TYPE = "text/event-stream"

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
    """Generation, as a fixed token sequence. Where it breaks decides what the
    endpoint has to emit as separate `token` events."""

    def __init__(self, tokens: Sequence[str]) -> None:
        self.tokens = list(tokens)

    def stream(self, messages: Sequence[ChatMessage]) -> Iterator[str]:
        yield from self.tokens


GENERATION_URL = "http://localhost:11434/v1/chat/completions"


class DeadStreamer:
    """A generation endpoint that is not there. Unlike the router's completer,
    the streaming path raises rather than degrading — and it raises after the
    response has already begun, which is what the `error` event is for."""

    def stream(self, messages: Sequence[ChatMessage]) -> Iterator[str]:
        raise APIConnectionError(request=httpx.Request("POST", GENERATION_URL))


class RefusingCompleter:
    """A model server that answers, with a refusal.

    Not a connection error: `complete_json` absorbs those into the `both`
    fallback all by itself, so only a *status* error reaches the endpoint. This
    is the first-run mistake — `LLM_MODEL` naming a model nobody pulled — and
    Ollama replies 404 to it.
    """

    def complete(self, messages: Sequence[ChatMessage]) -> str:
        request = httpx.Request("POST", GENERATION_URL)
        raise NotFoundError(
            "model 'qwen3:4b' not found",
            response=httpx.Response(404, request=request),
            body=None,
        )


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


def student() -> User:
    """The account every request below is made as.

    A real row, which it did not have to be until the conversation stage: a
    `Conversation` carries a foreign key to its owner, and a foreign key does
    not care that a `User` exists in memory. `get_or_create` so that repeated
    calls inside one test are the same student rather than a second one.
    """
    user, _ = User.objects.get_or_create(username="student")
    return user


def client_for(*, anonymous: bool = False) -> APIClient:
    """A client that is already logged in, without a login having happened.

    `force_authenticate` substitutes the whole authentication step, which is
    what keeps this file free of session cookies — the session itself is
    tests/test_accounts_api.py's subject. Note that an anonymous client is a
    bare one and *not* `force_authenticate(user=None)`, which logs the client
    out, and logging out flushes a session.
    """
    client = APIClient()
    if not anonymous:
        client.force_authenticate(user=student())
    return client


def ask(
    question: str = "What is an ORM?",
    accept: str | None = None,
    anonymous: bool = False,
    **extra: object,
):
    """One POST. Return type left to inference on purpose: what the test client
    hands back is Django's response wrapper, not the response the view built,
    and naming it here would be naming an implementation detail of the stubs."""
    # WSGI META rather than the `headers=` kwarg: that one reaches the test
    # client through DRF's `**extra` too, and this spelling is the one content
    # negotiation actually reads.
    meta: dict[str, Any] = {}
    if accept is not None:
        meta["HTTP_ACCEPT"] = accept
    return client_for(anonymous=anonymous).post(
        ASK_URL, {"question": question, **extra}, format="json", **meta
    )


def events(response: Any) -> list[tuple[str, Any]]:
    """The stream, parsed into `(event name, decoded data)` pairs.

    The unpacking below is an assertion in disguise: an event is exactly two
    lines, so a payload that smuggled a raw newline past the encoder would end
    its own `data:` field and blow up here instead of quietly arriving as an
    event the client never asked for.
    """
    body = b"".join(response.streaming_content).decode()
    parsed: list[tuple[str, Any]] = []
    for block in body.split("\n\n"):
        if not block:
            continue
        name_line, data_line = block.split("\n")
        parsed.append(
            (name_line.removeprefix("event: "), json.loads(data_line.removeprefix("data: ")))
        )
    return parsed


def ask_the_view(question: str = "What is an ORM?"):
    """The view's own response, without the test client's close emulation.

    `django.test.Client` wraps a streaming response so that reading it to the
    end closes it (`closing_iterator_wrapper`). The tests below close it by hand
    instead, because what they are about is the response object the view built
    and what closing it releases — the wrapper would do that closing for them.
    """
    request = APIRequestFactory().post(ASK_URL, {"question": question}, format="json")
    force_authenticate(request, user=student())
    return views_module.AskView.as_view()(request)


def read_one(response: Any) -> None:
    """Pull a single chunk and stop there — a reader who starts and then leaves."""
    next(iter(response.streaming_content))


def finish(response: Any) -> None:
    """Close a response the way a server does once it is done with it.

    Needed wherever a test looks at a 200 without reading it: the engine's queue
    lock is held until this response is closed. It goes through the same trick
    Django's test client uses when a stream is read to its end
    (`closing_iterator_wrapper`) — detaching `close_old_connections` from
    `request_finished` for the duration.

    That detachment used to be about keeping this file away from a database. It
    now protects the opposite thing: inside a `django_db` test everything runs
    in one open transaction, and `close_old_connections` sees an autocommit
    setting that does not match, closes the connection, and — being inside an
    atomic block — marks it closed-in-transaction. Every ORM assertion after
    that raises `InterfaceError` instead of failing on its own terms. Production
    is unaffected: the answer is settled inside `close()`, and the signal fires
    after it.
    """
    request_finished.disconnect(close_old_connections)
    try:
        response.close()
    finally:
        request_finished.connect(close_old_connections)


def names(stream: list[tuple[str, Any]]) -> list[str]:
    return [name for name, _ in stream]


def start_of(stream: list[tuple[str, Any]]) -> dict[str, Any]:
    return next(data for name, data in stream if name == "start")


def tokens_of(stream: list[tuple[str, Any]]) -> list[str]:
    return [data["text"] for name, data in stream if name == "token"]


def answer_of(stream: list[tuple[str, Any]]) -> str:
    """The answer is the concatenation of the token events and nothing else —
    the pieces break wherever the tokenizer did."""
    return "".join(tokens_of(stream))


def test_a_question_is_answered_from_the_index(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An ORM maps objects ", SLIDES_MARKER])
    response = ask()
    assert response.status_code == 200
    stream = events(response)
    assert start_of(stream)["question"] == "What is an ORM?"
    assert answer_of(stream) == f"An ORM maps objects {SLIDES_MARKER}"
    assert start_of(stream)["citations"][0]["text"] == ORM_TEXT


def test_the_stream_names_its_events_in_order(index: QdrantClient) -> None:
    """The shape Stage 4 is written against: context, then prose, then a
    terminator that says the answer is whole."""
    install_engine(index, SLIDES_ROUTE, ["An ORM ", "maps objects."])
    assert names(events(ask())) == ["start", "token", "token", "end"]


def test_the_answer_arrives_as_separate_token_events(index: QdrantClient) -> None:
    """Joining the generator was the whole of the previous design; the point of
    this one is that the pieces stay pieces all the way to the client."""
    install_engine(index, SLIDES_ROUTE, ["An ", "ORM ", "maps."])
    assert tokens_of(events(ask())) == ["An ", "ORM ", "maps."]


def test_sources_are_sent_before_the_first_token(index: QdrantClient) -> None:
    """Generation runs for tens of seconds. The excerpts it is grounded in are
    known before it starts, and a reader watching both appear together is
    watching the claim this system makes."""
    install_engine(index, SLIDES_ROUTE)
    stream = events(ask())
    assert names(stream).index("start") < names(stream).index("token")
    assert start_of(stream)["citations"]


def test_the_stream_is_served_as_text_event_stream(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE)
    response = ask()
    assert response.headers["Content-Type"] == SSE_MEDIA_TYPE
    # An answer is never reusable, and a cache between here and the reader would
    # hold it back until it was complete.
    assert response.headers["Cache-Control"] == "no-cache"
    finish(response)


def test_the_router_decision_reaches_the_stream(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    start = start_of(events(ask("Quando scadono le tasse?")))
    assert start["route"] == {
        "target": "unifi_web",
        "query": "tasse",
        "fresh": False,
        "reason": "administrative",
    }
    assert [citation["text"] for citation in start["citations"]] == [TASSE_TEXT]


def test_a_web_citation_carries_the_page_a_student_can_open(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    citation = start_of(events(ask("Quando scadono le tasse?")))["citations"][0]
    assert citation["marker"] == WEB_MARKER
    assert citation["kind"] == "web"
    assert citation["url"] == TASSE_URL
    assert citation["fetch_date"] == FETCH_DATE


def test_a_slides_citation_cites_the_file_and_page(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE)
    citation = start_of(events(ask()))["citations"][0]
    assert citation["marker"] == SLIDES_MARKER
    assert citation["kind"] == "slides"
    assert citation["url"] is None
    assert citation["fetch_date"] is None


def test_a_marker_split_across_tokens_survives_the_join(index: QdrantClient) -> None:
    """Why the server does not decide whether a source was cited.

    A citation marker is a bracketed label the model was told to copy verbatim,
    and nothing stops the tokenizer from breaking it in half. Matching it
    against any single token would report a marker that is plainly there as
    absent, so the check belongs to whoever holds the joined answer — the
    client, which also holds the marker.
    """
    install_engine(index, SLIDES_ROUTE, ["An ORM maps objects ", "[deck.", "pdf p.1]"])
    stream = events(ask())
    marker = start_of(stream)["citations"][0]["marker"]

    assert marker == SLIDES_MARKER
    assert not any(marker in token for token in tokens_of(stream))
    assert marker in answer_of(stream)


def test_a_token_containing_a_newline_stays_one_event(index: QdrantClient) -> None:
    """A `data:` field ends at the first newline. Answers are prose and prose
    has paragraphs, so this is the everyday case, not an edge one — JSON is what
    keeps it out of the framing."""
    install_engine(index, SLIDES_ROUTE, ["First line.\n\nSecond line."])
    assert tokens_of(events(ask())) == ["First line.\n\nSecond line."]


def test_a_non_ascii_answer_survives_the_wire(index: QdrantClient) -> None:
    """The domain is multilingual by definition; an encoding that only holds for
    English would fail on the corpus this system is built for."""
    install_engine(index, SLIDES_ROUTE, ["学费在 ", "11 月 30 日前缴纳。"])
    assert answer_of(events(ask("学费缴纳时间"))) == "学费在 11 月 30 日前缴纳。"


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
    assert start_of(events(response))["locale"] == "it"


def test_an_omitted_locale_is_detected_from_the_question(index: QdrantClient) -> None:
    install_engine(index, WEB_ROUTE)
    stream = events(ask("Quando scadono le tasse universitarie?"))
    assert start_of(stream)["locale"] == "it"


def test_an_explicit_null_locale_means_detect_it(index: QdrantClient) -> None:
    """`allow_null` is what separates "decide for me" from "" — a client that
    has no preference sends null rather than omitting the key."""
    install_engine(index, WEB_ROUTE)
    response = ask("Quando scadono le tasse universitarie?", locale=None)
    assert response.status_code == 200
    assert start_of(events(response))["locale"] == "it"


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


def test_a_client_asking_for_the_stream_is_not_refused(index: QdrantClient) -> None:
    """DRF negotiates content before the handler runs, so a renderer has to
    claim `text/event-stream` or the endpoint refuses the one media type it
    speaks with a 406."""
    install_engine(index, SLIDES_ROUTE)
    response = ask(accept=SSE_MEDIA_TYPE)
    assert response.status_code == 200
    assert names(events(response)) == ["start", "token", "end"]


def test_an_error_body_is_framed_for_a_client_reading_the_stream(index: QdrantClient) -> None:
    """The other side of that renderer: a caller parsing events gets its
    rejection as one, instead of a JSON object arriving mid-stream."""
    install_engine(index, SLIDES_ROUTE)
    response = ask("   ", accept=SSE_MEDIA_TYPE)
    assert response.status_code == 400
    assert response.headers["Content-Type"].startswith(SSE_MEDIA_TYPE)
    framed = response.content.decode()
    assert framed.startswith("event: error\ndata: ")
    assert "question" in json.loads(framed.removeprefix("event: error\ndata: "))


def test_a_generation_failure_ends_the_stream_without_an_end_event(index: QdrantClient) -> None:
    """Once the first event is out, the status code is spent. The failure that
    used to be a 503 has to travel inside the stream instead — and the absence
    of `end` is what tells the client the answer it holds is a fragment."""
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

    assert response.status_code == 200
    stream = events(response)
    assert names(stream) == ["start", "error"]
    assert "model server" in stream[-1][1]["detail"]


def test_an_unbuilt_index_becomes_503(tmp_path: Path) -> None:
    """A fresh checkout has no collection; the answer is a remedy, not a 500.

    Retrieval runs before the first event, so this one is still a status code —
    that boundary is the whole reason the view primes the stream by hand.
    """
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
    before generation, so it lands on the side of the boundary where a status
    code is still available."""
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

    start = start_of(events(ask()))
    slides_only.close()

    assert [citation["text"] for citation in start["citations"]] == [ORM_TEXT]


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


def test_an_anonymous_question_is_refused(index: QdrantClient) -> None:
    """The endpoint answered anybody until the login stage. It is the first
    thing a browser reaches, so the check that it no longer does belongs next to
    the answering it guards, not only in the settings file that turned it on."""
    install_engine(index, SLIDES_ROUTE)
    response = ask(anonymous=True)

    assert response.status_code == 403
    # Nothing was built and nothing was locked: permission is checked before the
    # handler runs, so an unauthenticated burst never reaches the GPU.
    assert engine_module._HOLDER.lock.acquire(blocking=False)
    engine_module._HOLDER.lock.release()


def test_the_ask_scope_rate_limit_returns_429(index: QdrantClient) -> None:
    """Answers are serialised on one GPU, so a burst has to be refused rather
    than queued into a timeout.

    Its own scope, not a rate shared with the login endpoints: what bounds this
    one is how fast the card can answer (config/settings.py).
    """
    codes = []
    for _ in range(5):
        install_engine(index, SLIDES_ROUTE, ["ok"])
        response = ask()
        codes.append(response.status_code)
        finish(response)
    assert codes[:4] == [200] * 4
    assert codes[4] == 429


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


def test_a_client_that_walks_away_releases_the_lock(index: QdrantClient) -> None:
    """The lock is taken in the view and released inside the generator, so the
    path nothing else exercises is the one that matters most: a reader who
    closes the tab halfway through an answer.

    Django closes the response for exactly that, and if closing did not reach
    the generator's `finally`, this process would hold its own queue lock
    forever and answer every later question with a 503.
    """
    install_engine(index, SLIDES_ROUTE, ["An ", "ORM ", "maps."])
    response = ask_the_view()

    read_one(response)  # the start event is delivered, then silence
    finish(response)  # what Django does when the connection goes away

    assert engine_module._HOLDER.lock.acquire(blocking=False)
    engine_module._HOLDER.lock.release()


def test_a_client_that_never_reads_a_byte_releases_the_lock(index: QdrantClient) -> None:
    """The same close, one step earlier — and the case that decides how the
    response body is written.

    Routing and retrieval have already run by the time the response exists, so
    the lock is held before the first chunk is asked for. A body written as a
    generator ignores `close()` when it was never iterated: its `finally` needs
    a body that started. Nothing would then give the lock back, and this process
    would answer 503 to everything from here on.
    """
    install_engine(index, SLIDES_ROUTE)
    response = ask_the_view()

    finish(response)  # not one chunk was ever pulled

    assert engine_module._HOLDER.lock.acquire(blocking=False)
    engine_module._HOLDER.lock.release()


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

    citations = start_of(events(ask()))["citations"]
    qdrant.close()

    assert len(citations) == 2
    assert {citation["marker"] for citation in citations} == {SLIDES_MARKER}
    assert {citation["text"] for citation in citations} == {first.text, second.text}


def turns_of(conversation: Conversation) -> list[tuple[str, str, bool]]:
    """Every stored message as `(role, text, complete)`, oldest first."""
    return [
        (message.role, message.text, message.complete)
        for message in Message.objects.filter(conversation=conversation)
    ]


def only_conversation() -> Conversation:
    """The student's one thread. Scoped by owner because several tests below
    also create a stranger's, which is the whole point of those tests."""
    return Conversation.objects.get(owner=student())


def test_a_question_starts_a_conversation_and_the_start_event_names_it(
    index: QdrantClient,
) -> None:
    """The client has no other way to learn the id, and it needs one to ask a
    follow-up."""
    install_engine(index, SLIDES_ROUTE, ["An answer."])
    stream = events(ask())

    assert start_of(stream)["conversation_id"] == only_conversation().pk


def test_a_finished_answer_is_stored_whole_and_marked_complete(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An ORM ", "maps objects."])
    events(ask())

    assert turns_of(only_conversation()) == [
        ("user", "What is an ORM?", True),
        ("assistant", "An ORM maps objects.", True),
    ]


def test_the_stored_answer_carries_its_citations_and_its_routing_decision(
    index: QdrantClient,
) -> None:
    """Without these two columns a reopened conversation is bare prose: no
    source cards, no citation badges, no visible routing decision."""
    install_engine(index, SLIDES_ROUTE)
    stream = events(ask())
    stored = Message.objects.get(conversation=only_conversation(), role="assistant")

    assert stored.citations == start_of(stream)["citations"]
    assert stored.route == start_of(stream)["route"]


def test_a_generation_failure_keeps_the_fragment_and_marks_it_incomplete(
    index: QdrantClient,
) -> None:
    """What the student saw is what is stored. The fragments are also the raw
    material for M3's error taxonomy, which deleting them would throw away."""
    engine = install_engine(index, SLIDES_ROUTE)
    engine_module._HOLDER.engine = Engine(
        client=engine.client,
        dense=engine.dense,
        sparse=engine.sparse,
        reranker=None,
        completer=ScriptedCompleter([SLIDES_ROUTE]),
        streamer=DeadStreamer(),
    )
    events(ask())

    role, text, complete = turns_of(only_conversation())[1]
    assert (role, text, complete) == ("assistant", "", False)


def test_a_reader_who_leaves_still_leaves_the_answer_behind(index: QdrantClient) -> None:
    """The everyday case — a closed tab — and the one that decides where the
    settling write goes: it has to be reachable from `close()`, not only from
    the end of the stream."""
    install_engine(index, SLIDES_ROUTE, ["An ORM ", "maps objects."])
    response = ask_the_view()

    read_one(response)  # the start event only
    finish(response)

    role, text, complete = turns_of(only_conversation())[1]
    assert role == "assistant"
    assert complete is False
    assert text != "An ORM maps objects."


def test_a_refused_question_leaves_no_message_behind(tmp_path: Path) -> None:
    """A 503 happens before the first event, which is exactly why the rows are
    written after it. Written earlier, every refusal would deposit a question
    with no answer under it and the next turn's history would have a hole."""
    empty = open_client(tmp_path / "empty")
    install_engine(empty, SLIDES_ROUTE)
    response = ask()
    empty.close()

    assert response.status_code == 503
    assert not Message.objects.exists()


def test_a_busy_engine_and_a_dead_one_are_told_apart(
    index: QdrantClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both are 503s and a client acts on them differently: a queue clears on
    its own, a model server that is not running does not."""
    install_engine(index, SLIDES_ROUTE)
    monkeypatch.setattr(engine_module, "QUEUE_TIMEOUT_SECONDS", 0.05)

    engine_module._HOLDER.lock.acquire()
    try:
        busy = ask()
    finally:
        engine_module._HOLDER.lock.release()

    assert busy.json()["reason"] == "busy"


def test_an_outage_is_not_worth_retrying(index: QdrantClient) -> None:
    engine = install_engine(index, SLIDES_ROUTE)
    engine_module._HOLDER.engine = Engine(
        client=engine.client,
        dense=engine.dense,
        sparse=engine.sparse,
        reranker=None,
        completer=RefusingCompleter(),
        streamer=ScriptedStreamer(["unreachable"]),
    )

    assert ask().json()["reason"] == "unavailable"


def test_a_follow_up_stays_in_the_same_conversation(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An answer."])
    first = start_of(events(ask()))

    install_engine(index, SLIDES_ROUTE, ["Another answer."])
    second = start_of(events(ask("And Active Record?", conversation_id=first["conversation_id"])))

    assert second["conversation_id"] == first["conversation_id"]
    assert Conversation.objects.count() == 1
    assert len(turns_of(only_conversation())) == 4


def test_a_follow_up_carries_the_earlier_questions_to_the_router(
    index: QdrantClient,
) -> None:
    """The point of the whole stage: "it" has no antecedent without them."""
    install_engine(index, SLIDES_ROUTE, ["An answer."])
    conversation_id = start_of(events(ask()))["conversation_id"]

    engine = install_engine(index, SLIDES_ROUTE, ["Another answer."])
    events(ask("How does it differ?", conversation_id=conversation_id))

    router_prompt = engine.completer.questions[-1]  # pyright: ignore[reportAttributeAccessIssue]
    assert "What is an ORM?" in router_prompt
    assert router_prompt.endswith("Question: How does it differ?")


def test_the_history_window_stops_at_its_limit(index: QdrantClient) -> None:
    """Older turns fall out rather than accumulating: the excerpts this answer
    is grounded in share the same context window."""
    conversation_id = None
    for number in range(HISTORY_WINDOW_TURNS + 1):
        # More questions than the `ask` bucket allows in a minute, and this test
        # is about the window rather than the limit.
        cache.clear()
        install_engine(index, SLIDES_ROUTE, ["An answer."])
        start = start_of(events(ask(f"Question {number}?", conversation_id=conversation_id)))
        conversation_id = start["conversation_id"]

    cache.clear()
    engine = install_engine(index, SLIDES_ROUTE, ["An answer."])
    events(ask("The last one?", conversation_id=conversation_id))

    router_prompt = engine.completer.questions[-1]  # pyright: ignore[reportAttributeAccessIssue]
    assert "Question 0?" not in router_prompt
    assert "Question 1?" in router_prompt


def test_somebody_elses_conversation_is_refused(index: QdrantClient) -> None:
    """An id is a small integer, so this is the whole of the access check. The
    message is the same one a conversation that never existed gets: telling
    them apart would say how many exist and whose they are."""
    install_engine(index, SLIDES_ROUTE)
    stranger = User.objects.create_user(username="stranger")
    theirs = Conversation.objects.create(owner=stranger, locale="it")

    response = ask(conversation_id=theirs.pk)

    assert response.status_code == 400
    assert "conversation_id" in response.json()
    assert not Message.objects.exists()


def test_a_conversation_that_never_existed_is_refused(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE)

    assert ask(conversation_id=4321).status_code == 400


def test_the_sidebar_lists_a_students_own_conversations(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An answer."])
    events(ask())
    stranger = User.objects.create_user(username="stranger")
    Conversation.objects.create(owner=stranger, locale="it")

    body = client_for().get(CONVERSATIONS_URL).json()

    assert [row["id"] for row in body] == [only_conversation().pk]
    assert body[0]["title"] == "What is an ORM?"


def test_a_conversation_refused_before_it_held_anything_is_not_listed(tmp_path: Path) -> None:
    """A 503 still starts a thread — the engine needs an id before it can fail
    — and an empty one in the sidebar would be a row that opens onto nothing."""
    empty = open_client(tmp_path / "empty")
    install_engine(empty, SLIDES_ROUTE)
    ask()
    empty.close()

    assert Conversation.objects.exists()
    assert client_for().get(CONVERSATIONS_URL).json() == []


def test_reopening_a_conversation_returns_what_the_stream_delivered(
    index: QdrantClient,
) -> None:
    """The guard on the two acceptance items this interface is judged by:
    citation badges and greyed-out sources have to survive a page reload, which
    means coming back from the database in the shape `start` delivered them."""
    install_engine(index, SLIDES_ROUTE, ["An ORM ", SLIDES_MARKER])
    stream = events(ask())
    conversation_id = start_of(stream)["conversation_id"]

    body = client_for().get(f"{CONVERSATIONS_URL}/{conversation_id}").json()

    answer_message = body["messages"][1]
    assert answer_message["text"] == f"An ORM {SLIDES_MARKER}"
    assert answer_message["citations"] == start_of(stream)["citations"]
    assert answer_message["route"] == start_of(stream)["route"]


def test_somebody_elses_conversation_is_not_there_to_open(index: QdrantClient) -> None:
    """Missing rather than forbidden: a 403 would confirm the id names
    something real."""
    stranger = User.objects.create_user(username="stranger")
    theirs = Conversation.objects.create(owner=stranger, locale="it")

    assert client_for().get(f"{CONVERSATIONS_URL}/{theirs.pk}").status_code == 404


def test_the_conversation_api_needs_a_login() -> None:
    assert client_for(anonymous=True).get(CONVERSATIONS_URL).status_code == 403
