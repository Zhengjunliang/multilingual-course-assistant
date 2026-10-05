"""The process-wide retrieval and generation resources, and the one call that
uses them.

Django is a long-lived process; the pipeline was written for one-shot CLIs.
Two things follow from that difference.

**The models load once.** The dense encoder comes from
`rag.index.cached_dense_encoder` because that cache is its declared owner
(rag/index.py) — building a second one would cost another ~2.4GB of host RAM.
The sparse encoder, the reranker, the Qdrant client and the two LLM clients are
this process's own: nothing in `rag/` caches them, and nothing in `rag/`
should, because a CLI that loads one and exits has nothing to share.

**Questions are answered one at a time.** An 8GB card cannot host two
concurrent rerank-plus-generate passes, so this process serialises them; the
index is the Qdrant service, which the terminal and the worker query at the
same time (docker-compose.yml).

Retrieval and generation logic is not reimplemented here. This module routes
through `rag.agent.route`, retrieves through `rag.search.search` and generates
through `rag.answer.answer`, whose tokens it forwards one at a time. What it
yields are the event models of apps/qa/contract.py; the SSE framing around them
belongs to the HTTP layer and never appears in this file.

**No query runs in this file, and that is a rule rather than a coincidence.**
The conversation history arrives already sliced, as `rag.answer.Turn` — plain
data — and the conversation id arrives as an integer, because this module emits
the `start` event and that event carries one. Loading either is the view's job
(apps/qa/conversations.py), and `tests/test_qa_api.py` asserts that answering a
question touches no database at all.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from django.utils.translation import gettext_lazy as _

from apps.qa.contract import Citation, EndEvent, ErrorEvent, Event, StartEvent, TokenEvent
from rag.agent import collections_for, route
from rag.answer import answer
from rag.chunk import detect_locale
from rag.search import search

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator, Sequence

    from qdrant_client import QdrantClient

    from rag.answer import Turn
    from rag.index import DenseEncoder, SparseEncoder
    from rag.llm import ChatStreamer, Completer
    from rag.search import Reranker

logger = logging.getLogger(__name__)

# The CLI default (`rag.answer`, `rag.agent`), restated rather than imported
# because those are argparse defaults rather than a shared constant.
TOP_K = 5

# How long a request may wait for the one in front of it. Answers take tens of
# seconds each, so a queue deeper than this belongs to a client that will time
# out anyway; refusing it with a retry hint beats holding a socket open until
# the worker is killed.
QUEUE_TIMEOUT_SECONDS = 90.0

# One message for both LLM roles: the router and the generator talk to the same
# endpoint, so whichever notices first is reporting the same outage.
LLM_DOWN = _(
    "The generation endpoint did not respond. Check that the model server is "
    "running (Ollama by default)."
)

# The index is the compose service every process shares (docker-compose.yml);
# naming the service, not a command, keeps server commands out of what the
# caller reads.
INDEX_DOWN = _("The search index did not respond. Check that the Qdrant service is running.")


class EngineUnavailableError(Exception):
    """A dependency this endpoint cannot answer without is out of reach.

    Deliberately not a DRF exception: the engine knows nothing about HTTP, and
    choosing a status code is the view's job. The message is written to be
    shown to whoever called the API — no filesystem paths, no stack — while the
    original exception travels as `__cause__` for the log.

    Raised only from the part of `Engine.stream` that runs before its first
    event. Once an event has been yielded the response is already on the wire
    and a failure has to travel as `ErrorEvent` instead.

    Its messages are marked for translation like every other user-facing string
    here, and no catalogue translates them: for the thesis these read as the
    English written below. Three languages meet in this project and each has an
    owner — the interface belongs to the frontend's own catalogues, the answer's
    language to the prompt in rag/answer.py, and this layer to whoever is
    reading a server log next to it. A fourth translation layer would be work
    with no reader.

    The markers stay because they cost nothing and losing them costs a hunt
    through every string. One visible consequence, worth knowing before it
    looks like a bug: DRF ships its own translated validation messages and
    LANGUAGE_CODE is Italian, so a single error body can mix its Italian with
    this module's English.
    """


class EngineBusyError(EngineUnavailableError):
    """Someone else's question is still being answered.

    A subclass rather than a flag because the caller's correct response differs:
    this one is worth retrying in a moment, an outage is not.
    """


@dataclass(frozen=True)
class Engine:
    """Everything one answered question needs, injected rather than built.

    Same shape as the pipeline itself: `rag.search.search` takes its encoders
    as arguments and never constructs one. That is what lets a test drive this
    class end to end with stub encoders over a temporary index, with no GPU and
    no network.
    """

    client: QdrantClient
    dense: DenseEncoder
    sparse: SparseEncoder
    reranker: Reranker | None
    completer: Completer
    streamer: ChatStreamer

    def stream(
        self,
        question: str,
        conversation_id: int,
        locale: str | None = None,
        history: Sequence[Turn] = (),
    ) -> Iterator[Event]:
        """Route, retrieve, generate — the read-only three quarters of `rag.agent`.

        The deepening loop is not here on purpose: it fetches live pages and
        writes them into the *shared* index, which the roadmap puts behind an
        account and a rate limit, and three fetches at tens of seconds each do
        not belong in one synchronous request.

        Everything up to `StartEvent` can still fail into a status code, which
        is why routing and retrieval happen before the first `yield` rather than
        lazily alongside the tokens. After it, the only way to report a failure
        is to describe it inside the stream.
        """
        # Lazy on purpose: `rag/` imports the OpenAI SDK and qdrant-client inside
        # the functions that need them, and Django's startup should not pay for
        # them either.
        from openai import APIError
        from pydantic import ValidationError
        from qdrant_client.http.exceptions import ResponseHandlingException

        answer_locale = locale or detect_locale(question)

        try:
            # An unusable router *reply* is already a routing decision — `route`
            # degrades to `target="both"` and says so in `reason`, a frozen
            # contract this layer does not second-guess. An unreachable router
            # is a different event: `complete_json` only absorbs connection
            # errors, so a refused model name or a 500 from the server arrives
            # here as an exception and must not become one of ours.
            # History reaches the router as the student's earlier questions and
            # nothing else — rag/answer.py's `format_history_questions` explains
            # why the answers stay out of a prompt that demands strict JSON.
            decision = route(question, self.completer, history)
        except APIError as exc:
            logger.warning("routing failed: %s", exc)
            raise EngineUnavailableError(LLM_DOWN) from exc

        try:
            # `both` is also what the router falls back to, so a question can be
            # aimed at a collection this index never built: a fresh checkout
            # follows docs/development.md, runs `rag.index` under its default
            # `--collection slides`, and has no `unifi_web` at all. Dropping what
            # is absent keeps such a question answerable from the half that
            # exists, instead of turning a perfectly good slides corpus into a 503.
            available = tuple(
                name for name in collections_for(decision) if self.client.collection_exists(name)
            )
            if not available:
                raise EngineUnavailableError(
                    _(
                        "The search index cannot answer yet. Build it with "
                        "`uv run python -m rag.index data/chunks`."
                    )
                )

            # No `except ValueError` around this: with the collections checked
            # above, the remaining ones are payload drift and mismatched reranker
            # output — real defects, which deserve a traceback in the log rather
            # than a 503 telling the caller to rebuild an index that is fine.
            hits = search(
                self.client,
                # Retrieval runs on the rewritten query; generation below keeps
                # the student's original wording, which is what must be answered.
                decision.query,
                self.dense,
                self.sparse,
                self.reranker,
                # `None`: every edition; the caller's scope, computed from their
                # programme, is `#36` (docs/data-model.md).
                scope=None,
                limit=TOP_K,
                collections=available,
            )
        except ResponseHandlingException as exc:
            # qdrant-client wraps two failures in this one class: the transport
            # (the server is down or unreachable) and a 200 reply it could not
            # parse. The second is a client and server of mismatched versions, a
            # defect that keeps its traceback, as does an HTTP error status
            # (`UnexpectedResponse`, never caught here) — the line drawn above
            # for ValueError.
            if isinstance(exc.source, ValidationError):
                raise
            logger.warning("index unreachable: %s", exc)
            raise EngineUnavailableError(INDEX_DOWN) from exc

        yield StartEvent(
            question=question,
            conversation_id=conversation_id,
            locale=answer_locale,
            route=decision,
            citations=[Citation.of(hit) for hit in hits],
        )

        try:
            # An empty hit list never reaches the model — it becomes an honest
            # refusal inside `rag.answer`, which arrives here as one token.
            for delta in answer(question, hits, self.streamer, answer_locale, history):
                yield TokenEvent(text=delta)
        except APIError as exc:
            # Unlike `complete_json`, which swallows a dead endpoint into a
            # fallback, the streaming path raises. `str()` because the message
            # is a lazy translation proxy and the event field is a string.
            logger.warning("generation failed: %s", exc)
            yield ErrorEvent(detail=str(LLM_DOWN))
            return

        yield EndEvent()


def build_engine() -> Engine:
    """Load this process's copy of the pipeline.

    The Qdrant client connects on first use, so an unreachable server surfaces
    on the first question, as a 503 from `Engine.stream`, and a server that
    comes back needs no rebuild.
    """
    from config.env import env
    from rag.index import build_sparse_encoder, cached_dense_encoder, open_client
    from rag.llm import build_completer, build_streamer
    from rag.search import DEFAULT_RERANK_MODEL, build_reranker

    client = None
    try:
        # QDRANT_URL (config/env.py): the server every process shares. A URL
        # the client cannot parse (a port past 65535) fails here, and is
        # converted like any other build failure.
        client = open_client()
        # Greedy decoding stated rather than inherited, matching the CLIs: the
        # same question must produce the same answer across two runs of a gate.
        return Engine(
            client=client,
            dense=cached_dense_encoder(),
            sparse=build_sparse_encoder(),
            reranker=build_reranker(DEFAULT_RERANK_MODEL),
            completer=build_completer(
                env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0, seed=0
            ),
            streamer=build_streamer(
                env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0
            ),
        )
    except Exception as exc:
        # A failed build is not cached, so the next request opens a client of
        # its own; closing this one — after a first-run download or an
        # out-of-memory card fails a model load — keeps its connections from
        # piling up with every retry. Converting the failure also matters on its
        # own: an exception escaping here carries a frame holding `env`, and
        # Django's debug page prints frame locals verbatim.
        if client is not None:
            client.close()
        logger.exception("engine build failed")
        raise EngineUnavailableError(
            _("The question service could not start. See the server log.")
        ) from exc


@dataclass
class _Holder:
    """One engine per process, filled on first use.

    A holder rather than a module global that gets rebound: `global` is what
    ruff's PLW0603 objects to, and a slot reads the same. Tests fill it with a
    stub engine to keep the view under test away from any model load.
    """

    engine: Engine | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


_HOLDER = _Holder()


def stream_answer(
    question: str,
    conversation_id: int,
    locale: str | None = None,
    history: Sequence[Turn] = (),
) -> Generator[Event, None, None]:
    """One question at a time, on the one set of models this process loaded.

    Typed as a generator rather than an iterator because `close()` is part of
    what the caller is handed, not an implementation detail: it is the only way
    to give the lock back without reading the stream to its end.

    **Nothing here runs until the caller asks for the first event.** A generator
    body starts on the first `next()`, so that call is where the lock is taken —
    which is deliberate: it lets the caller run routing and retrieval while it
    can still answer with a status code (apps/qa/views.py), and it means a
    generator built and dropped without being read costs nothing.

    The lock is released by the `finally` below on all three ways out: the
    stream ended, it raised, or the caller closed it. That last one is the
    everyday case — a reader who navigates away — and it does more than free the
    queue: the generator is suspended on a `yield`, so closing it also stops
    pulling tokens from a model nobody is listening to.

    The lock covers the build as well, because two first requests arriving
    together must not each load a reranker. A failed build is not cached — the
    slot stays empty, so the next request tries again once whatever broke has
    been fixed.

    The wait is bounded because the rate limit alone cannot bound it: the limit
    is per client address, while the queue is per process, and an answer takes
    tens of seconds. Waiting without a ceiling turns a burst into sockets held
    until the worker is killed — which reaches the caller as a dropped
    connection, the one outcome worse than a refusal.
    """
    if not _HOLDER.lock.acquire(timeout=QUEUE_TIMEOUT_SECONDS):
        raise EngineBusyError(
            _("The question service is busy answering another question. Try again shortly.")
        )
    try:
        if _HOLDER.engine is None:
            _HOLDER.engine = build_engine()
        yield from _HOLDER.engine.stream(question, conversation_id, locale, history)
    finally:
        _HOLDER.lock.release()
