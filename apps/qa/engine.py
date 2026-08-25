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

**Questions are answered one at a time.** The lock is not only about the
embedded Qdrant's exclusive directory lock: an 8GB card cannot host two
concurrent rerank-plus-generate passes either, so the serialisation outlives
the move to a Qdrant server. What that move does remove is the collision with
the terminal — while this process holds the embedded index, an
`uv run python -m rag.index` in another window cannot open it, and that
collision arrives here as `EngineUnavailableError`.

Retrieval and generation logic is not reimplemented here. This module routes
through `rag.agent.route`, retrieves through `rag.search.search` and generates
through `rag.answer.answer`, which is the same generator Stage 3 will stream
token by token instead of joining.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from django.utils.translation import gettext_lazy as _

from apps.qa.contract import AskResponse, Citation
from rag.agent import collections_for, route
from rag.answer import answer
from rag.chunk import detect_locale
from rag.search import search

if TYPE_CHECKING:
    from qdrant_client import QdrantClient

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


class EngineUnavailableError(Exception):
    """A dependency this endpoint cannot answer without is out of reach.

    Deliberately not a DRF exception: the engine knows nothing about HTTP, and
    choosing a status code is the view's job. The message is written to be
    shown to whoever called the API — no filesystem paths, no stack — while the
    original exception travels as `__cause__` for the log.

    Its messages are marked for translation like every other user-facing string
    here. No catalogue exists yet, so they currently read as the English written
    below while DRF's own validation errors — which ship with translations —
    answer in the caller's language. Marking them now is what makes a later
    `makemessages` complete rather than a rewrite.
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

    def ask(self, question: str, locale: str | None = None) -> AskResponse:
        """Route, retrieve, generate — the read-only three quarters of `rag.agent`.

        The deepening loop is not here on purpose: it fetches live pages and
        writes them into the *shared* index, which the roadmap puts behind an
        account and a rate limit, and three fetches at tens of seconds each do
        not belong in one synchronous request.
        """
        # Lazy on purpose: `rag/` imports the OpenAI SDK inside the functions
        # that need it, and Django's startup should not pay for it either.
        from openai import APIError

        answer_locale = locale or detect_locale(question)

        try:
            # An unusable router *reply* is already a routing decision — `route`
            # degrades to `target="both"` and says so in `reason`, a frozen
            # contract this layer does not second-guess. An unreachable router
            # is a different event: `complete_json` only absorbs connection
            # errors, so a refused model name or a 500 from the server arrives
            # here as an exception and must not become one of ours.
            decision = route(question, self.completer)
        except APIError as exc:
            logger.warning("routing failed: %s", exc)
            raise EngineUnavailableError(LLM_DOWN) from exc

        # `both` is also what the router falls back to, so a question can be
        # aimed at a collection this index never built: a fresh checkout follows
        # the README, runs `rag.index` under its default `--collection slides`,
        # and has no `unifi_web` at all. Dropping what is absent keeps such a
        # question answerable from the half that exists, instead of turning a
        # perfectly good slides corpus into a 503.
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
            limit=TOP_K,
            collections=available,
        )

        try:
            # `answer` is a generator; joining it is all that separates this
            # endpoint from the streaming one. An empty hit list never reaches
            # the model — it becomes an honest refusal inside `rag.answer`.
            answer_text = "".join(answer(question, hits, self.streamer, answer_locale))
        except APIError as exc:
            # Unlike `complete_json`, which swallows a dead endpoint into a
            # fallback, the streaming path raises: a half-generated answer is
            # worse than none.
            logger.warning("generation failed: %s", exc)
            raise EngineUnavailableError(LLM_DOWN) from exc

        return AskResponse(
            question=question,
            locale=answer_locale,
            answer=answer_text,
            route=decision,
            citations=[Citation.of(hit, answer_text) for hit in hits],
        )


def build_engine() -> Engine:
    """Load this process's copy of the pipeline.

    The index is opened first, before ~2.4GB of encoders: opening is where the
    expected failure lives (another process holding the embedded directory),
    and spending half a minute on model loads only to fail on a lock would make
    every retry cost that half minute again.
    """
    from config.env import env
    from rag.index import (
        DEFAULT_QDRANT_DIR,
        build_sparse_encoder,
        cached_dense_encoder,
        open_client,
    )
    from rag.llm import build_completer, build_streamer
    from rag.search import DEFAULT_RERANK_MODEL, build_reranker

    try:
        client = open_client(DEFAULT_QDRANT_DIR)
    except RuntimeError as exc:
        logger.warning("index unavailable: %s", exc)
        raise EngineUnavailableError(
            _(
                "The search index is held by another process. Stop any `rag.index`, "
                "`rag.search` or `rag.agent` command running in a terminal, then retry."
            )
        ) from exc

    try:
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
        # The lock this client holds is released by `close()` and by nothing
        # else. A model load that fails — a first-run download, an out-of-memory
        # card — would otherwise strand it: the slot stays empty by design, so
        # the next request builds again, collides with *this process's own*
        # lock, and is told to stop a terminal command that was never running.
        # Converting the failure also matters on its own: an exception escaping
        # here carries a frame holding `env`, and Django's debug page prints
        # frame locals verbatim.
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


def answer_question(question: str, locale: str | None = None) -> AskResponse:
    """One question at a time, on the one set of models this process loaded.

    The lock covers the build as well as the call: two first requests arriving
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
        return _HOLDER.engine.ask(question, locale)
    finally:
        _HOLDER.lock.release()
