"""The process-wide retrieval and generation resources, and the one call that
uses them.

They live in the Celery worker that answers questions (apps/qa/tasks.py),
never in the web process, which only relays what the worker writes. A worker
is a long-lived process; the pipeline was written for one-shot CLIs. Two
things follow from that difference.

**The models load once.** The dense encoder comes from
`rag.index.cached_dense_encoder` because that cache is its declared owner
(rag/index.py) — building a second one would cost another ~2.4GB of host RAM.
The sparse encoder, the reranker, the Qdrant client and the two LLM clients are
this process's own: nothing in `rag/` caches them, and nothing in `rag/`
should, because a CLI that loads one and exits has nothing to share.

**Retrieval takes turns; generation does not.** The encoders and the
reranker run on the GPU, so the threads of one worker take them one at a
time, under a lock held for retrieval alone. Generation runs outside it,
because generating several answers at once is the model server's job (vLLM
batches them, Ollama queues them), and a lock here would only serialise what
that server can overlap. The index is the Qdrant service, which the terminal
and the worker query at the same time (docker-compose.yml).

Retrieval and generation logic is not reimplemented here. This module routes
through `rag.agent.route`, retrieves through `rag.search.search` and generates
through `rag.answer.answer`, whose tokens it forwards one at a time. What it
yields are the event models of apps/qa/contract.py; the SSE framing around them
belongs to the HTTP layer and never appears in this file.

**No query runs in this file, and that is a rule rather than a coincidence.**
The conversation history arrives already sliced, as `rag.answer.Turn` — plain
data — and the conversation id arrives as a UUID, or None for an anonymous
question, because this module emits the `start` event and that event carries
it. Loading either is the web view's job, before the question is queued
(apps/qa/conversations.py), and `tests/test_qa_engine.py` asserts that the
engine touches no database at all.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from apps.qa.contract import Citation, EndEvent, Event, StartEvent, TokenEvent
from rag.agent import collections_for, route
from rag.answer import answer
from rag.chunk import detect_locale
from rag.search import RELEVANCE_CUTOFF, search

if TYPE_CHECKING:
    from collections.abc import Generator, Sequence
    from uuid import UUID

    from qdrant_client import QdrantClient

    from rag.answer import Turn
    from rag.chunk import EditionKey
    from rag.index import DenseEncoder, SparseEncoder
    from rag.llm import ChatStreamer, Completer
    from rag.search import Reranker

# The most sources an answer is given: `search()` keeps fewer when the reranker
# calls the rest irrelevant (`RELEVANCE_CUTOFF`). The CLI default (`rag.answer`,
# `rag.agent`), restated rather than imported because those are argparse
# defaults rather than a shared constant.
TOP_K = 5

# One message for both LLM roles: the router and the generator talk to the same
# endpoint, so whichever notices first is reporting the same outage.
LLM_DOWN = (
    "The generation endpoint did not respond. Check that the model server is "
    "running (Ollama by default)."
)

# The index is the compose service every process shares (docker-compose.yml).
INDEX_DOWN = "The search index did not respond. Check that the Qdrant service is running."


class EngineUnavailableError(Exception):
    """A dependency this endpoint cannot answer without is out of reach.

    Deliberately not a DRF exception: the engine knows nothing about HTTP, and
    what the caller is told is the task's choice, an `error` event with the
    code `ENGINE_DOWN` (apps/qa/tasks.py). The message is for the server log,
    where the task writes it with the original exception, its `__cause__`: it
    names the service that is down and the command that starts it, which no
    caller is shown (#14).
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
    # Held for retrieval and nothing else: the module docstring says why.
    gpu: threading.Lock = field(default_factory=threading.Lock, compare=False, repr=False)

    def stream(
        self,
        question: str,
        conversation_id: UUID | None,
        locale: str | None = None,
        history: Sequence[Turn] = (),
        *,
        scope: Sequence[EditionKey] | None,
        asked_at: float | None = None,
    ) -> Generator[Event, None, None]:
        """Route, retrieve, generate — the read-only three quarters of `rag.agent`.

        The deepening loop is not here on purpose: it fetches live pages and
        writes them into the *shared* index, which the roadmap puts behind an
        account and a rate limit, and three fetches at tens of seconds each do
        not belong in one synchronous request.

        `scope` is the slides editions the caller may be answered from, with
        `rag.search.search`'s meaning, and is required for the same reason it
        is there: it decides what a caller can read, so every call states it.

        `asked_at` is the `time.time()` reading `StartEvent.search_ms` counts
        from: the task passes the moment the web process admitted the
        question, wall-clock time because that moment was read in another
        process; a direct caller, which has no queue, leaves it to this call.

        Everything up to `StartEvent` fails before anything is stored, which is
        why routing and retrieval happen before the first `yield` rather than
        lazily alongside the tokens: the task writes the conversation's rows
        only once `start` exists (apps/qa/tasks.py).
        """
        # Lazy on purpose: `rag/` imports the OpenAI SDK and qdrant-client inside
        # the functions that need them, and Django's startup should not pay for
        # them either.
        from httpx import TransportError
        from openai import APIError
        from pydantic import ValidationError
        from qdrant_client.http.exceptions import ResponseHandlingException

        answer_locale = locale or detect_locale(question)
        started = time.time() if asked_at is None else asked_at

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
            raise EngineUnavailableError(LLM_DOWN) from exc

        try:
            # `both` is also what the router falls back to, so a question can be
            # aimed at a collection this index never built: a fresh checkout
            # follows docs/development.md, runs `rag.index` under its default
            # `--collection slides`, and has no `unifi_web` at all. Dropping what
            # is absent keeps such a question answerable from the half that
            # exists, instead of turning a perfectly good slides corpus into an outage.
            available = tuple(
                name for name in collections_for(decision) if self.client.collection_exists(name)
            )
            if not available:
                raise EngineUnavailableError(
                    "The search index cannot answer yet. Build it with "
                    "`uv run python -m rag.index data/chunks`."
                )

            # No `except ValueError` around this: with the collections checked
            # above, the remaining ones are payload drift and mismatched reranker
            # output — real defects, which deserve a traceback in the log rather
            # than an outage telling the caller to rebuild an index that is fine.
            with self.gpu:
                hits = search(
                    self.client,
                    # Retrieval runs on the rewritten query; generation below
                    # keeps the student's original wording, which is what must
                    # be answered.
                    decision.query,
                    self.dense,
                    self.sparse,
                    self.reranker,
                    scope=scope,
                    limit=TOP_K,
                    min_score=RELEVANCE_CUTOFF,
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
            raise EngineUnavailableError(INDEX_DOWN) from exc

        yield StartEvent(
            question=question,
            conversation_id=conversation_id,
            locale=answer_locale,
            route=decision,
            citations=[Citation.of(hit) for hit in hits],
            # Never below zero: `asked_at` is the web host's clock, and a
            # worker's may be behind it.
            search_ms=max(0, round((time.time() - started) * 1000)),
        )

        try:
            # An empty hit list never reaches the model — it becomes an honest
            # refusal inside `rag.answer`, which arrives here as one token.
            for delta in answer(question, hits, self.streamer, answer_locale, history):
                yield TokenEvent(text=delta)
        except (APIError, TransportError) as exc:
            # Unlike `complete_json`, which swallows a dead endpoint into a
            # fallback, the streaming path raises. openai wraps what httpx raises
            # while it sends the request, not while it reads the stream, so a
            # model server that drops the connection mid-answer is httpx's own.
            raise EngineUnavailableError(LLM_DOWN) from exc

        yield EndEvent()


@dataclass(frozen=True)
class Retrieval:
    """The half of an `Engine` that finds the sources: the index and the models
    that read it.

    Built by the callable `QA_RETRIEVAL` names (config/settings.py), as Django
    builds its mail backend from `EMAIL_BACKEND`, so a process is pointed at
    another index without a branch in this file: the browser journeys run on
    stub encoders over an in-memory index (tests/journeys/retrieval.py). The
    generation half has no such setting; those journeys run it unchanged,
    against a fake model server.
    """

    client: QdrantClient
    dense: DenseEncoder
    sparse: SparseEncoder
    reranker: Reranker | None


def build_retrieval() -> Retrieval:
    """The Qdrant service, the two encoders and the reranker.

    The Qdrant client connects on first use, so an unreachable server surfaces
    on the first question, as `ENGINE_DOWN` from `Engine.stream`, and a server that
    comes back needs no rebuild.
    """
    from rag.index import build_sparse_encoder, cached_dense_encoder, open_client
    from rag.search import DEFAULT_RERANK_MODEL, build_reranker

    # QDRANT_URL (config/env.py): the server every process shares. A URL the
    # client cannot parse (a port past 65535) fails here, and `build_engine`
    # converts it like any other build failure.
    client = open_client()
    try:
        return Retrieval(
            client=client,
            dense=cached_dense_encoder(),
            sparse=build_sparse_encoder(),
            reranker=build_reranker(DEFAULT_RERANK_MODEL),
        )
    except Exception:
        # A failed build is not cached, so the next request opens a client of
        # its own; closing this one — after a first-run download or an
        # out-of-memory card fails a model load — keeps its connections from
        # piling up with every retry.
        client.close()
        raise


def build_engine() -> Engine:
    """Load this process's copy of the pipeline: the two LLM clients, and the
    retrieval `QA_RETRIEVAL` names."""
    from django.conf import settings
    from django.utils.module_loading import import_string

    from config.env import env
    from rag.llm import build_completer, build_streamer

    try:
        # Greedy decoding stated rather than inherited, matching the CLIs: the
        # same question must produce the same answer across two runs of a gate.
        completer = build_completer(
            env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0, seed=0
        )
        streamer = build_streamer(env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0)
        # Last, because it is the part holding connections: a retrieval built
        # is never dropped by a failure after it.
        retrieval: Retrieval = import_string(settings.QA_RETRIEVAL)()
    except Exception as exc:
        # Converting the failure is what makes it an `ENGINE_DOWN` the caller can wait out
        # rather than an `INTERNAL`; its traceback reaches the log as this error's cause.
        raise EngineUnavailableError("The question service could not start.") from exc
    return Engine(
        client=retrieval.client,
        dense=retrieval.dense,
        sparse=retrieval.sparse,
        reranker=retrieval.reranker,
        completer=completer,
        streamer=streamer,
    )


@dataclass
class _Holder:
    """One engine per process, filled on first use.

    A holder rather than a module global that gets rebound: `global` is what
    ruff's PLW0603 objects to, and a slot reads the same. Tests fill it with a
    stub engine to keep the task under test away from any model load.
    """

    engine: Engine | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


_HOLDER = _Holder()


def loaded_engine() -> Engine:
    """This process's engine, built by the first caller.

    The lock covers the build, because two first questions arriving together
    on two threads must not each load a reranker. A failed build is not
    cached: the slot stays empty, so the next question tries again once
    whatever broke has been fixed.
    """
    with _HOLDER.lock:
        if _HOLDER.engine is None:
            _HOLDER.engine = build_engine()
        return _HOLDER.engine
