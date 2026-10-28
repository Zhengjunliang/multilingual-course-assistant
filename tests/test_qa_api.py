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
being. Here it holds for an anonymous question alone, which is stored nowhere
and is held to zero queries below.

Sessions are not exercised here either. `force_authenticate` replaces
authentication wholesale, so a test of what `SessionAuthentication` enforces
would be testing nothing; CSRF, cookies and login live in
tests/test_accounts_api.py against a real one.
"""

import dataclasses
import json
import logging
import uuid
from collections.abc import Iterator, Sequence
from pathlib import Path
from types import EllipsisType
from typing import Any

import httpx
import pytest
from django.core.cache import cache
from django.core.signals import request_finished
from django.db import close_old_connections, connection
from django.test.utils import CaptureQueriesContext
from openai import APIConnectionError, NotFoundError
from pydantic import ValidationError
from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import ResponseHandlingException
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from test_agent import ScriptedCompleter
from test_error_contract import refused
from test_index import StubDense, StubSparse, make_chunk

from apps.accounts.models import User
from apps.qa import engine as engine_module
from apps.qa import views as views_module
from apps.qa.conversations import thread
from apps.qa.engine import LLM_DOWN, Engine
from apps.qa.models import HISTORY_WINDOW_TURNS, Conversation, Message
from apps.qa.serializers import MAX_HISTORY_ANSWER_CHARS, MAX_QUESTION_CHARS
from config.env import env
from config.request_id import RequestIdFilter
from rag import index as rag_index
from rag import search as rag_search
from rag.chunk import Chunk
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.llm import ChatStreamer
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
    endpoint has to emit as separate `token` events. `prompts` keeps what each
    call was given, joined, for the tests about what reaches generation."""

    def __init__(self, tokens: Sequence[str]) -> None:
        self.tokens = list(tokens)
        self.prompts: list[str] = []

    def stream(self, messages: Sequence[ChatMessage]) -> Iterator[str]:
        self.prompts.append("\n".join(message["content"] for message in messages))
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


@dataclasses.dataclass
class StreamerThatFails:
    """A generation endpoint that sends a token and then fails with `failure`.

    openai's `Stream` reads the response without wrapping what httpx raises, so
    a model server that drops the connection mid-answer arrives as httpx's own
    exception, not as an `APIError`.
    """

    failure: Exception

    def stream(self, messages: Sequence[ChatMessage]) -> Iterator[str]:
        yield "Half an answer"
        raise self.failure


def install_dead_generation(client: QdrantClient, streamer: ChatStreamer | None = None) -> None:
    """An engine whose generation endpoint dies once the stream has begun."""
    engine = install_engine(client, SLIDES_ROUTE)
    engine_module._HOLDER.engine = dataclasses.replace(engine, streamer=streamer or DeadStreamer())


def install_refusing_router(client: QdrantClient) -> None:
    """An engine whose model server refuses the router, before the stream has begun."""
    engine = install_engine(client, SLIDES_ROUTE)
    engine_module._HOLDER.engine = dataclasses.replace(engine, completer=RefusingCompleter())


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
    """The shape the frontend is written against: context, then prose, then a
    terminator that says the answer is whole."""
    install_engine(index, SLIDES_ROUTE, ["An ORM ", "maps objects."])
    assert names(events(ask())) == ["start", "token", "token", "end"]


def test_the_answer_arrives_as_separate_token_events(index: QdrantClient) -> None:
    """Joining the generator was the whole of the previous design; the point of
    this one is that the pieces stay pieces all the way to the client."""
    install_engine(index, SLIDES_ROUTE, ["An ", "ORM ", "maps."])
    assert tokens_of(events(ask())) == ["An ", "ORM ", "maps."]


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


@pytest.mark.parametrize(
    ("route", "question", "expected"),
    [
        pytest.param(
            WEB_ROUTE,
            "Quando scadono le tasse?",
            {
                "marker": WEB_MARKER,
                "kind": "web",
                "url": TASSE_URL,
                "fetch_date": FETCH_DATE,
                "source_sha256": None,
                "academic_year": None,
            },
            id="a-web-page-a-student-can-open",
        ),
        pytest.param(
            SLIDES_ROUTE,
            "What is an ORM?",
            {
                "marker": SLIDES_MARKER,
                "kind": "slides",
                "url": None,
                "fetch_date": None,
                "source_sha256": "ab" * 32,
                "academic_year": "2025-2026",
            },
            id="a-file-and-its-page",
        ),
    ],
)
def test_a_citation_carries_what_opens_its_source(
    index: QdrantClient, route: str, question: str, expected: dict[str, str | None]
) -> None:
    install_engine(index, route)
    citation = start_of(events(ask(question)))["citations"][0]
    assert {key: citation[key] for key in expected} == expected


def test_a_marker_split_across_tokens_survives_the_join(index: QdrantClient) -> None:
    """Why the server does not decide whether a source was cited.

    A citation is a bracketed label, `[1]` or the marker an older answer
    copied, and nothing stops the tokenizer from breaking it in half. Matching
    it against any single token would report a citation that is plainly there
    as absent, so the check belongs to whoever holds the joined answer — the
    client, which also holds the citations.
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


@pytest.mark.parametrize(
    ("question", "locale", "field", "reason", "data"),
    [
        pytest.param("   ", None, "question", "REQUIRED", {}, id="blank-question"),
        # The cap the page's sentence names, read off the serializer's field.
        pytest.param(
            "a" * (MAX_QUESTION_CHARS + 1),
            None,
            "question",
            "TOO_LONG",
            {"max_length": MAX_QUESTION_CHARS},
            id="question-over-the-cap",
        ),
        # An empty string is not a way of saying "decide for me", as null is: it
        # is a client sending a field it failed to fill in.
        pytest.param("What is an ORM?", "", "locale", "REQUIRED", {}, id="blank-locale"),
        # `english` is a language name, not a tag; passing it through would
        # filter every result away and read as an empty corpus.
        pytest.param("What is an ORM?", "english", "locale", "INVALID", {}, id="not-a-subtag"),
    ],
)
def test_a_question_or_a_locale_the_client_got_wrong_is_rejected(
    index: QdrantClient,
    question: str,
    locale: str | None,
    field: str,
    reason: str,
    data: dict[str, int],
) -> None:
    install_engine(index, SLIDES_ROUTE)
    response = ask(question) if locale is None else ask(question, locale=locale)
    assert response.status_code == 400
    assert refused(response) == ("INVALID_ARGUMENT", {field: [reason]})
    assert [violation["data"] for violation in response.json()["error"]["fields"]] == [data]


@pytest.mark.parametrize(
    "locale",
    [
        pytest.param("it-IT", id="a-regional-tag"),
        # `...`: the request carries no `locale` key at all.
        pytest.param(..., id="omitted"),
        # `allow_null` is what separates "decide for me" from "": a client that
        # has no preference sends null rather than omitting the key.
        pytest.param(None, id="null"),
    ],
)
def test_a_locale_is_normalised_or_detected_from_the_question(
    index: QdrantClient, locale: str | EllipsisType | None
) -> None:
    install_engine(index, WEB_ROUTE)
    question = "Quando scadono le tasse universitarie?"
    response = ask(question) if locale is ... else ask(question, locale=locale)
    assert response.status_code == 200
    assert start_of(events(response))["locale"] == "it"


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
    error = json.loads(framed.removeprefix("event: error\ndata: "))["error"]
    assert (error["code"], [each["field"] for each in error["fields"]]) == (
        "INVALID_ARGUMENT",
        ["question"],
    )


def test_a_generation_failure_ends_the_stream_without_an_end_event(index: QdrantClient) -> None:
    """Once the first event is out, the status code is spent. The failure that
    used to be a 503 has to travel inside the stream instead — and the absence
    of `end` is what tells the client the answer it holds is a fragment."""
    install_dead_generation(index)
    response = ask()

    assert response.status_code == 200
    stream = events(response)
    assert names(stream) == ["start", "error"]
    assert stream[-1][1]["error"]["code"] == "ENGINE_DOWN"


def test_a_failure_inside_the_stream_is_one_line_under_the_requests_id(
    index: QdrantClient, caplog: pytest.LogCaptureFixture
) -> None:
    """The stream is read after the response has left the middleware that set
    the request's id (config/request_id.py), and its event and its log line
    still carry the id in the response's header. The engine's sentence, which
    names the model server, is in that line and not in the event (#14)."""
    install_dead_generation(index)
    caplog.handler.addFilter(RequestIdFilter())

    with caplog.at_level(logging.WARNING):
        response = ask()
        error = events(response)[-1][1]["error"]

    request_id = response["X-Request-ID"]
    [line] = caplog.records
    assert (line.levelno, getattr(line, "request_id", None)) == (logging.ERROR, request_id)
    assert error["request_id"] == request_id
    assert LLM_DOWN in caplog.text
    assert "model server" not in json.dumps(error)


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (httpx.RemoteProtocolError("peer closed connection"), "ENGINE_DOWN"),
        (RuntimeError("a defect"), "INTERNAL"),
    ],
    ids=["model-server-gone", "defect"],
)
def test_a_failure_after_the_first_token_still_ends_the_stream_in_one_line(
    index: QdrantClient, caplog: pytest.LogCaptureFixture, failure: Exception, code: str
) -> None:
    """Whatever stops an answer midway ends it with the `error` event and one
    line under the request's id, the traceback on it; nothing escapes to the
    server's console without the id."""
    install_dead_generation(index, StreamerThatFails(failure))
    caplog.handler.addFilter(RequestIdFilter())

    with caplog.at_level(logging.WARNING):
        response = ask()
        stream = events(response)

    [line] = caplog.records
    assert (line.levelno, getattr(line, "request_id", None)) == (
        logging.ERROR,
        response["X-Request-ID"],
    )
    assert line.exc_info is not None
    assert [name for name, _ in stream][-2:] == ["token", "error"]
    assert stream[-1][1]["error"]["code"] == code


def test_an_unbuilt_index_becomes_503(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """A fresh checkout has no collection: an outage, not a 500. The remedy is a
    server command, so it is in the log line for the 503 and not in its body (#14).

    Retrieval runs before the first event, so this one is still a status code —
    that boundary is the whole reason the view primes the stream by hand.
    """
    empty = open_client(tmp_path / "empty")
    install_engine(empty, SLIDES_ROUTE)
    with caplog.at_level(logging.ERROR, logger="config.errors"):
        response = ask()
    empty.close()

    assert (response.status_code, refused(response)) == (503, ("ENGINE_DOWN", {}))
    assert "rag.index" not in response.content.decode()
    assert "uv run python -m rag.index" in caplog.text


def unparsable_reply() -> ValidationError:
    """What qdrant-client wraps when a 200 reply has another schema: the answer
    to `collection_exists` without its `exists` field."""
    try:
        models.CollectionExistence.model_validate({})
    except ValidationError as exc:
        return exc
    raise AssertionError("an empty reply validated")


@pytest.mark.parametrize(
    ("source", "is_503"),
    [
        # What qdrant-client wraps when nothing listens on the port, in the
        # wording Windows gives a refused connection.
        (httpx.ConnectError("[WinError 10061] connection refused"), True),
        (unparsable_reply(), False),
    ],
    ids=["unreachable", "schema-drift"],
)
def test_an_index_server_that_fails_is_a_503_only_when_unreachable(
    index: QdrantClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    source: Exception,
    is_503: bool,
) -> None:
    """qdrant-client raises one exception class for both: a stopped Qdrant
    service is an outage the caller can wait out, while a reply the client
    cannot parse is a client and server of mismatched versions — a defect,
    which must reach the log with its traceback rather than pass for an outage."""

    def fail(collection_name: str) -> bool:
        raise ResponseHandlingException(source)

    install_engine(index, SLIDES_ROUTE)
    monkeypatch.setattr(index, "collection_exists", fail)

    if not is_503:
        with caplog.at_level("ERROR", logger="config.errors"):
            response = ask()
        assert (response.status_code, refused(response)) == (500, ("INTERNAL", {}))
        [line] = [record for record in caplog.records if record.name == "config.errors"]
        assert line.exc_info is not None
        assert line.exc_info[0] is ResponseHandlingException
        return
    response = ask()
    assert (response.status_code, refused(response)) == (503, ("ENGINE_DOWN", {}))
    assert "Qdrant" not in response.content.decode()


def test_a_router_the_server_refuses_becomes_503(
    index: QdrantClient, caplog: pytest.LogCaptureFixture
) -> None:
    """The first-run mistake — the model was never pulled — reaches routing
    before generation, so it lands on the side of the boundary where a status
    code is still available.

    One line in the log for it, the 503's, with the engine's error and the
    server's refusal as its causes: the engine writes none of its own."""
    install_refusing_router(index)

    with caplog.at_level(logging.WARNING):
        response = ask()

    assert (response.status_code, refused(response)) == (503, ("ENGINE_DOWN", {}))
    assert [record.getMessage() for record in caplog.records] == [
        "POST api/ask 503 ENGINE_DOWN: A service the answer needs is not running."
    ]
    assert LLM_DOWN in caplog.text
    assert "model 'qwen3:4b' not found" in caplog.text


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
    an out-of-memory card — must close the client it opened.

    The failed build is not cached, so every later request opens a client of
    its own; one left open on each retry is a leak. An embedded index stands in
    for the server because it shows the leak: reopening the same directory
    raises while the first client still holds it.
    """
    path = tmp_path / "qdrant"
    monkeypatch.setattr(rag_index, "open_client", lambda location=None: open_client(path))
    monkeypatch.setattr(rag_index, "cached_dense_encoder", lambda *_, **__: StubDense())
    monkeypatch.setattr(rag_index, "build_sparse_encoder", StubSparse)

    def explode(model_name: str) -> object:
        raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(rag_search, "build_reranker", explode)

    response = ask()

    assert response.status_code == 503
    assert engine_module._HOLDER.engine is None
    # Raises if the failed build left its client open.
    reopened = open_client(path)
    reopened.close()


def test_a_qdrant_url_the_client_cannot_parse_is_a_503(monkeypatch: pytest.MonkeyPatch) -> None:
    """config/env.py checks only the scheme; qdrant-client parses the rest when
    the client is built. A failure there is converted like any other build
    failure, into a 503."""
    monkeypatch.setattr(env, "qdrant_url", "http://127.0.0.1:65536")

    def unreachable(*_: object, **__: object) -> object:
        pytest.fail("the build went past the Qdrant client")

    monkeypatch.setattr(rag_index, "cached_dense_encoder", unreachable)

    response = ask()

    assert response.status_code == 503
    assert engine_module._HOLDER.engine is None


@pytest.mark.parametrize("anonymous", [False, True], ids=["logged-in", "anonymous"])
def test_the_ask_scope_rate_limit_returns_429(index: QdrantClient, anonymous: bool) -> None:
    """Answers are serialised on one GPU, so a burst has to be refused rather
    than queued into a timeout.

    Its own scope, not a rate shared with the login endpoints: what bounds this
    one is how fast the card can answer (config/settings.py). An anonymous
    caller is counted by address, at the same rate.
    """
    codes = []
    for _ in range(5):
        install_engine(index, WEB_ROUTE, ["ok"])
        response = ask(anonymous=True, history=[]) if anonymous else ask()
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


@pytest.mark.parametrize("chunks", [1, 0], ids=["halfway", "before-a-byte"])
def test_a_client_that_walks_away_releases_the_lock(index: QdrantClient, chunks: int) -> None:
    """The lock is taken in the view and released inside the generator, so the
    path nothing else exercises is the one that matters most: a reader who
    closes the tab halfway through an answer.

    Django closes the response for exactly that, and if closing did not reach
    the generator's `finally`, this process would hold its own queue lock
    forever and answer every later question with a 503.

    The same close one step earlier, before a byte was read, decides how the
    response body is written. Routing and retrieval have run by the time the
    response exists, so the lock is held before the first chunk is asked for,
    and a body written as a generator ignores `close()` when it was never
    iterated: its `finally` needs a body that started.
    """
    install_engine(index, SLIDES_ROUTE, ["An ", "ORM ", "maps."])
    response = ask_the_view()

    for _ in range(chunks):
        read_one(response)  # the start event is delivered, then silence
    finish(response)  # what Django does when the connection goes away

    assert engine_module._HOLDER.lock.acquire(blocking=False)
    engine_module._HOLDER.lock.release()


def test_two_chunks_of_one_page_stay_two_citations(tmp_path: Path) -> None:
    """The contract merges copies of one passage, never two passages of one
    page: two chunks of one page share a marker but carry different text, and
    merging them would drop an excerpt the reader was answered from."""
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
    """Every message of the thread as `(role, text, complete)`, oldest first.

    Along the chain, not by timestamp: the two rows of one exchange can share
    one, and their random ids would then order them by chance."""
    return [
        (message.role, message.text, message.complete)
        for message in thread(
            conversation.current_leaf_id, Message.objects.filter(conversation=conversation)
        )
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

    # A string on the wire, as every id the API returns.
    assert start_of(stream)["conversation_id"] == str(only_conversation().pk)


def test_a_finished_answer_is_stored_whole_and_marked_complete(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An ORM ", "maps objects."])
    events(ask())

    assert turns_of(only_conversation()) == [
        ("user", "What is an ORM?", True),
        ("assistant", "An ORM maps objects.", True),
    ]


def test_a_generation_failure_keeps_the_fragment_and_marks_it_incomplete(
    index: QdrantClient,
) -> None:
    """What the student saw is what is stored. The fragments are also the raw
    material for M3's error taxonomy, which deleting them would throw away."""
    install_dead_generation(index)
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


def test_a_conversation_deleted_mid_answer_leaves_nothing_behind(index: QdrantClient) -> None:
    """The sidebar's delete of the conversation being answered: the answer is
    stopped, the delete arrives, and the server settles the answer after it.
    The rows go with the conversation, and the settling write finds nothing to
    write and raises nothing."""
    install_engine(index, SLIDES_ROUTE, ["An ORM ", "maps objects."])
    response = ask_the_view()

    read_one(response)  # the start event: both rows are written
    deleted = client_for().delete(f"{CONVERSATIONS_URL}/{only_conversation().pk}")
    finish(response)

    assert deleted.status_code == 204
    assert not Conversation.objects.exists()
    assert not Message.objects.exists()


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

    assert (busy.status_code, refused(busy)) == (503, ("UNAVAILABLE", {}))
    assert busy.json()["error"]["data"] == {"retry_after_seconds": views_module.RETRY_AFTER_SECONDS}


def test_an_outage_is_not_worth_retrying(index: QdrantClient) -> None:
    install_refusing_router(index)

    response = ask()

    assert refused(response) == ("ENGINE_DOWN", {})
    assert "Retry-After" not in response.headers


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
    # The order, not the template's wording: that is rag.agent's, pinned in tests/test_agent.py.
    assert router_prompt.index("What is an ORM?") < router_prompt.index("How does it differ?")


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


@pytest.mark.parametrize("whose", ["stranger", "nobody"])
def test_somebody_elses_conversation_is_refused(index: QdrantClient, whose: str) -> None:
    """An id is not a credential: whoever holds one is still asked to own it,
    and this is the whole of the access check. The message is the same one a
    conversation that never existed gets: telling them apart would say whose
    they are."""
    install_engine(index, SLIDES_ROUTE)
    stranger = User.objects.create_user(username="stranger")
    theirs = Conversation.objects.create(owner=stranger, locale="it")

    response = ask(conversation_id=theirs.pk if whose == "stranger" else str(uuid.uuid4()))

    assert (response.status_code, refused(response)) == (404, ("CONVERSATION_GONE", {}))
    assert not Message.objects.exists()


@pytest.mark.parametrize("conversation_id", ["abc", 7, True], ids=["text", "integer", "boolean"])
def test_a_conversation_id_that_is_not_a_uuid_string_is_malformed(conversation_id: object) -> None:
    """A field the client got wrong, not a conversation that is missing. DRF's
    own field would read `7` as the UUID ending in 7, and `true` as the one
    ending in 1, and answer that no such conversation exists."""
    response = ask(conversation_id=conversation_id)

    assert (response.status_code, refused(response)) == (
        400,
        ("INVALID_ARGUMENT", {"conversation_id": ["INVALID"]}),
    )
    assert not Conversation.objects.exists()


def test_the_sidebar_lists_a_students_own_conversations(index: QdrantClient) -> None:
    install_engine(index, SLIDES_ROUTE, ["An answer."])
    events(ask())
    stranger = User.objects.create_user(username="stranger")
    theirs = Conversation.objects.create(owner=stranger, locale="it")
    # Held something, or the list would leave it out for that alone.
    Message.objects.create(conversation=theirs, role=Message.Role.USER, text="?", locale="it")

    body = client_for().get(CONVERSATIONS_URL).json()

    assert [row["id"] for row in body] == [str(only_conversation().pk)]
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
    citation pills and the sources panel have to survive a page reload, which
    means coming back from the database in the shape `start` delivered them."""
    install_engine(index, SLIDES_ROUTE, ["An ORM ", SLIDES_MARKER])
    stream = events(ask())
    conversation_id = start_of(stream)["conversation_id"]

    body = client_for().get(f"{CONVERSATIONS_URL}/{conversation_id}").json()

    assert body["id"] == conversation_id
    assert all(isinstance(message["id"], str) for message in body["messages"])
    answer_message = body["messages"][1]
    assert answer_message["text"] == f"An ORM {SLIDES_MARKER}"
    assert answer_message["citations"] == start_of(stream)["citations"]
    assert answer_message["route"] == start_of(stream)["route"]
    assert answer_message["search_ms"] == start_of(stream)["search_ms"]
    # The student's half has no search of its own: the column is empty there.
    assert body["messages"][0]["search_ms"] is None


class DeletingCompleter:
    """A router that, while the question is being routed, sees the student
    delete the conversation from another tab — the window in which a question
    waits for the engine — and then routes as usual."""

    def __init__(self, conversation_pk: uuid.UUID) -> None:
        self.conversation_pk = conversation_pk

    def complete(self, messages: Sequence[ChatMessage]) -> str:
        Conversation.objects.filter(pk=self.conversation_pk).delete()
        return SLIDES_ROUTE


def test_a_conversation_deleted_while_its_question_waits_is_refused(
    index: QdrantClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Refused before anything is written, as the serializer refuses an unknown
    id, and with the answer slot freed by the view itself.

    The test keeps a reference to the engine's generator. Without it, CPython
    would collect the abandoned generator as the request ends and run its
    `finally` anyway, so the lock check could not tell the view's
    `events.close()` from the runtime's."""
    mine = Conversation.objects.create(owner=student(), locale="it")
    engine = install_engine(index, SLIDES_ROUTE)
    engine_module._HOLDER.engine = dataclasses.replace(engine, completer=DeletingCompleter(mine.pk))
    kept = []

    def keeping(*args: Any, **kwargs: Any) -> Any:
        events = engine_module.stream_answer(*args, **kwargs)
        kept.append(events)
        return events

    monkeypatch.setattr(views_module, "stream_answer", keeping)

    response = ask(conversation_id=mine.pk)

    assert (response.status_code, refused(response)) == (404, ("CONVERSATION_GONE", {}))
    assert len(kept) == 1
    assert engine_module._HOLDER.lock.locked() is False
    assert not Message.objects.exists()


@pytest.mark.parametrize("deleted", [True, False], ids=["deleted", "kept"])
def test_a_conversation_deleted_before_its_history_is_read_is_refused(
    index: QdrantClient, monkeypatch: pytest.MonkeyPatch, deleted: bool
) -> None:
    """Found by the serializer and gone by the time its messages are read: a
    leaf with no rows under it, which is the refusal of an unknown id rather
    than a broken thread. Kept, the same follow-up is answered, so the refusal
    comes from that read and nothing else."""
    install_engine(index, SLIDES_ROUTE, ["An answer."])
    conversation_id = start_of(events(ask()))["conversation_id"]
    install_engine(index, SLIDES_ROUTE, ["Another answer."])
    if deleted:

        def then_deleted(owner: User, existing: Conversation) -> Conversation:
            Conversation.objects.filter(pk=existing.pk).delete()
            return existing

        monkeypatch.setattr(views_module, "open_conversation", then_deleted)

    response = ask("And Active Record?", conversation_id=conversation_id)

    if deleted:
        assert (response.status_code, refused(response)) == (404, ("CONVERSATION_GONE", {}))
    else:
        assert answer_of(events(response)) == "Another answer."


# What an anonymous browser sends back after one campus exchange.
FEES_TURN = {"question": "Quando scadono le tasse?", "answer": f"Il 30 novembre {WEB_MARKER}."}


def test_an_anonymous_question_is_answered_without_a_query(index: QdrantClient) -> None:
    """Nothing of an anonymous student's is kept, and the strongest way to say
    so is that the whole request, stream included, makes no query at all."""
    install_engine(index, WEB_ROUTE, ["Entro il 30 novembre ", WEB_MARKER])

    with CaptureQueriesContext(connection) as captured:
        stream = events(ask("E se pago in ritardo?", anonymous=True, history=[FEES_TURN]))

    assert captured.captured_queries == []
    assert names(stream) == ["start", "token", "token", "end"]
    assert start_of(stream)["conversation_id"] is None


@pytest.mark.parametrize(
    ("route_reply", "kinds"),
    [(BOTH_ROUTE, ["web"]), (SLIDES_ROUTE, [])],
    ids=["both", "slides"],
)
def test_an_anonymous_question_never_reaches_course_material(
    index: QdrantClient, route_reply: str, kinds: list[str]
) -> None:
    """Course material is for students with an account. A question routed to
    both collections is answered from the campus half; one routed to slides
    alone finds nothing, and the model is never asked to answer it."""
    engine = install_engine(index, route_reply)

    stream = events(ask(anonymous=True, history=[]))

    assert [citation["kind"] for citation in start_of(stream)["citations"]] == kinds
    if not kinds:
        assert engine.streamer.prompts == []  # pyright: ignore[reportAttributeAccessIssue]


def test_an_anonymous_history_reaches_the_router_and_generation(index: QdrantClient) -> None:
    """The history the browser sends plays the part a stored one plays: the
    router gets the earlier questions, generation the whole exchanges."""
    engine = install_engine(index, WEB_ROUTE)

    events(ask("E se pago in ritardo?", anonymous=True, history=[FEES_TURN]))

    router_prompt = engine.completer.questions[-1]  # pyright: ignore[reportAttributeAccessIssue]
    generation_prompt = engine.streamer.prompts[-1]  # pyright: ignore[reportAttributeAccessIssue]
    assert FEES_TURN["question"] in router_prompt
    assert "Il 30 novembre" not in router_prompt
    assert FEES_TURN["question"] in generation_prompt
    assert "Il 30 novembre" in generation_prompt


@pytest.mark.parametrize(
    "history",
    [
        [FEES_TURN] * (HISTORY_WINDOW_TURNS + 1),
        [{**FEES_TURN, "question": "x" * (MAX_QUESTION_CHARS + 1)}],
        [{**FEES_TURN, "answer": "x" * (MAX_HISTORY_ANSWER_CHARS + 1)}],
        [{**FEES_TURN, "question": "   "}],
        [{"question": FEES_TURN["question"]}],
        [FEES_TURN["question"]],
        FEES_TURN,
        None,
    ],
    ids=[
        "too-many-turns",
        "question-too-long",
        "answer-too-long",
        "blank-question",
        "no-answer",
        "turn-not-an-object",
        "not-a-list",
        "null",
    ],
)
def test_an_anonymous_history_out_of_bounds_is_refused(
    index: QdrantClient, history: object
) -> None:
    """The browser's copy is untrusted input, bounded before anything runs."""
    engine = install_engine(index, WEB_ROUTE)

    response = ask(anonymous=True, history=history)

    assert response.status_code == 400
    code, fields = refused(response)
    assert code == "INVALID_ARGUMENT"
    assert {str(field).split(".")[0] for field in fields} == {"history"}
    assert engine.completer.questions == []  # pyright: ignore[reportAttributeAccessIssue]


def test_an_anonymous_history_at_its_bounds_is_accepted(index: QdrantClient) -> None:
    """A full window, an answer at its cap and an answer that never arrived."""
    install_engine(index, WEB_ROUTE)
    history = [
        FEES_TURN,
        {**FEES_TURN, "answer": "x" * MAX_HISTORY_ANSWER_CHARS},
        {**FEES_TURN, "answer": ""},
    ]

    response = ask(anonymous=True, history=history)

    assert len(history) == HISTORY_WINDOW_TURNS
    assert response.status_code == 200
    finish(response)


@pytest.mark.parametrize("names_a_conversation", [False, True], ids=["no-history", "an-id"])
def test_a_request_shaped_for_a_session_that_has_none_is_refused_as_one_that_ended(
    index: QdrantClient, names_a_conversation: bool
) -> None:
    """No history, or a conversation's id, is what a signed-in client sends;
    arriving without a session, it is one whose session ended in another tab
    or ran out. It gets the 401 that client acts on, before anything runs,
    rather than an answer as a visitor that it would render as its own and
    then lose."""
    engine = install_engine(index, WEB_ROUTE)
    theirs = Conversation.objects.create(owner=student(), locale="it")

    response = (
        ask(anonymous=True, conversation_id=theirs.pk, history=[])
        if names_a_conversation
        else ask(anonymous=True)
    )

    assert (response.status_code, refused(response)) == (401, ("UNAUTHENTICATED", {}))
    assert engine.completer.questions == []  # pyright: ignore[reportAttributeAccessIssue]
    assert not Message.objects.exists()


def test_a_logged_in_question_cannot_bring_its_own_history(index: QdrantClient) -> None:
    """A logged-in conversation's history is the stored one. A copy sent
    alongside it, empty or not, could only contradict it."""
    install_engine(index, WEB_ROUTE)

    response = ask(history=[])

    assert response.status_code == 400
    assert refused(response) == ("INVALID_ARGUMENT", {"history": ["INVALID"]})
    assert not Conversation.objects.exists()
