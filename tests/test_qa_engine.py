"""The process-wide engine: one at a time, one build, and no database.

**No `django_db` marker anywhere, and that is the point of the file.**
pytest-django refuses any query a test without the marker attempts, so these
tests do not merely avoid the database — they prove the engine layer never
reaches one. tests/test_qa_api.py used to carry that promise for the whole
endpoint; the conversation stage made the endpoint write rows, and rather than
weaken the claim to nothing it was narrowed to the layer where it is still true
and still load-bearing: `apps/qa/engine.py` receives a sliced history and an
integer, and looks nothing up.

The rest is the serialisation. One card cannot host two concurrent
rerank-and-generate passes, so answers queue — and nothing in the HTTP tests
would notice if that lock were deleted, because a test client asks one question
at a time. These use threads and a fake clock instead.
"""

import threading
import time
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import cast

import pytest
from test_agent import ScriptedCompleter
from test_index import StubDense, StubSparse, make_chunk
from test_qa_api import ORM_TEXT, SLIDES_ROUTE, ScriptedStreamer

from apps.qa import engine as engine_module
from apps.qa.contract import EndEvent, Event, StartEvent
from apps.qa.engine import Engine
from rag.agent import RouteDecision
from rag.answer import Turn
from rag.index import ensure_collection, index_chunks, open_client

CONVERSATION_ID = 7


class CountingEngine:
    """An engine that records whether two answers were ever in flight at once.

    It sleeps rather than yielding instantly on purpose: with no work inside
    the critical section, threads would serialise by accident and the test
    would pass against a missing lock.
    """

    def __init__(self) -> None:
        self.guard = threading.Lock()
        self.inside = 0
        self.peak_concurrency = 0
        self.calls = 0

    def stream(
        self,
        question: str,
        conversation_id: int,
        locale: str | None = None,
        history: Sequence[Turn] = (),
    ) -> Iterator[Event]:
        with self.guard:
            self.inside += 1
            self.calls += 1
            self.peak_concurrency = max(self.peak_concurrency, self.inside)
        time.sleep(0.02)
        with self.guard:
            self.inside -= 1
        yield StartEvent(
            question=question,
            conversation_id=conversation_id,
            locale=locale or "en",
            route=RouteDecision.model_validate_json(SLIDES_ROUTE),
            citations=[],
        )
        yield EndEvent()


def drain(question: str = "What is an ORM?") -> None:
    """Consume a whole stream. The threads below must go through this rather
    than through `stream_answer` directly: calling a generator function only
    builds the generator, so a thread that stopped there would take no lock and
    the two tests would pass against a deleted one."""
    list(engine_module.stream_answer(question, CONVERSATION_ID))


def test_the_engine_answers_without_touching_the_database(tmp_path: Path) -> None:
    """The invariant this file exists for, stated rather than implied.

    Routing, retrieval and generation are the thesis; a conversation is a
    product feature wrapped around them. Keeping the query count at zero here is
    what lets the pipeline be evaluated with no web stack at all, and this test
    turns red the day an ORM import creeps into `apps/qa/engine.py`.
    """
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    engine = Engine(
        client=qdrant,
        dense=StubDense(),
        sparse=StubSparse(),
        reranker=None,
        completer=ScriptedCompleter([SLIDES_ROUTE]),
        streamer=ScriptedStreamer(["An answer."]),
    )

    events = list(
        engine.stream(
            "How does it differ?",
            CONVERSATION_ID,
            history=[Turn(question="What is an ORM?", answer="It maps objects to tables.")],
        )
    )
    qdrant.close()

    assert [type(event).NAME for event in events] == ["start", "token", "end"]
    assert cast("StartEvent", events[0]).conversation_id == CONVERSATION_ID


def test_a_stream_nobody_reads_takes_no_lock() -> None:
    """A generator body does not run until the first `next()`, which is what
    lets the view do routing and retrieval at the last moment a status code is
    still available. Building one and dropping it must cost nothing."""
    engine_module._HOLDER.engine = cast("Engine", CountingEngine())

    unread = engine_module.stream_answer("What is an ORM?", CONVERSATION_ID)
    try:
        assert engine_module._HOLDER.lock.acquire(blocking=False)
        engine_module._HOLDER.lock.release()
    finally:
        unread.close()


def test_answers_never_overlap() -> None:
    """The serialisation is the whole design — one card, one embedded index —
    and nothing in the HTTP tests would notice if the lock were deleted.

    Driven through `stream_answer` rather than HTTP: the claim is about the
    module's own guard, and threads plus a test client would only add noise.
    """
    engine = CountingEngine()
    engine_module._HOLDER.engine = cast("Engine", engine)

    threads = [threading.Thread(target=drain) for _ in range(4)]
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

    threads = [threading.Thread(target=drain) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(builds) == 1
