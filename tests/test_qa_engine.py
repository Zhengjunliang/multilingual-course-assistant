"""The worker's engine: retrieval one at a time, generation side by side, one
build, and no database.

**No `django_db` marker anywhere, and that is the point of the file.**
pytest-django refuses any query a test without the marker attempts, so these
tests do not merely avoid the database — they prove the engine layer never
reaches one. `apps/qa/engine.py` receives a sliced history and a conversation
id, and looks nothing up; the task around it writes the rows
(tests/test_qa_api.py).

The rest is the concurrency of one worker's threads. One card cannot run two
retrievals at once, and a model server can generate two answers at once, so
the lock covers retrieval alone — and nothing in the HTTP tests would notice
if it were deleted or widened, because they answer one question at a time.
These use threads instead.
"""

import threading
import time
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from uuid import UUID

import pytest
from test_agent import ScriptedCompleter
from test_index import StubDense, StubSparse, make_chunk
from test_qa_api import ORM_TEXT, SLIDES_ROUTE, ScriptedStreamer

from apps.qa import engine as engine_module
from apps.qa.engine import Engine, EngineUnavailableError
from rag.agent import RouteDecision
from rag.answer import Turn
from rag.index import ensure_collection, index_chunks, open_client

if TYPE_CHECKING:
    from qdrant_client import QdrantClient

    from apps.qa.contract import StartEvent

CONVERSATION_ID = UUID("3f1c9a52-6b0e-4d7a-9c1e-2a5b8d4f0e17")


def stub_engine(tmp_path: Path) -> Engine:
    """An engine over a one-chunk temporary index, with no GPU and no network."""
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    return Engine(
        client=qdrant,
        dense=StubDense(),
        sparse=StubSparse(),
        reranker=None,
        completer=ScriptedCompleter([SLIDES_ROUTE]),
        streamer=ScriptedStreamer(["An answer."]),
    )


def test_the_engine_answers_without_touching_the_database(tmp_path: Path) -> None:
    """The invariant this file exists for, stated rather than implied.

    Routing, retrieval and generation are the thesis; a conversation is a
    product feature wrapped around them. Keeping the query count at zero here is
    what lets the pipeline be evaluated with no web stack at all, and this test
    turns red the day an ORM import creeps into `apps/qa/engine.py`.
    """
    engine = stub_engine(tmp_path)

    events = list(
        engine.stream(
            "How does it differ?",
            CONVERSATION_ID,
            history=[Turn(question="What is an ORM?", answer="It maps objects to tables.")],
            scope=None,
        )
    )
    engine.client.close()

    assert [type(event).NAME for event in events] == ["start", "token", "end"]
    assert cast("StartEvent", events[0]).conversation_id == CONVERSATION_ID


@pytest.mark.parametrize(
    ("asked_at", "readings", "expected_ms"),
    [
        pytest.param(None, [10.0, 11.4996], 1500, id="read-by-the-call"),
        # The task passes the admission's reading: the wait for a worker, and
        # the first build of the models, are in what the reader waited.
        pytest.param(10.0, [40.0], 30_000, id="from-the-admission"),
        # A worker whose clock is behind the web host's must not make it
        # negative, which the row's column refuses.
        pytest.param(50.0, [40.0], 0, id="a-worker-clock-behind"),
    ],
)
def test_the_search_time_counts_from_when_the_question_was_asked(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    asked_at: float | None,
    readings: list[float],
    expected_ms: int,
) -> None:
    """`search_ms` ends when `start` goes out and begins at `asked_at`, or
    when the call began if there is none. The clock is the engine module's
    own, so the stub moves no other code's time."""
    clock = iter(readings)
    monkeypatch.setattr(engine_module, "time", SimpleNamespace(time=lambda: next(clock)))
    engine = stub_engine(tmp_path)

    events = engine.stream("What is an ORM?", CONVERSATION_ID, scope=None, asked_at=asked_at)
    try:
        start = next(events)
    finally:
        events.close()
        engine.client.close()

    assert cast("StartEvent", start).search_ms == expected_ms


def test_retrieval_takes_turns_and_generation_does_not(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two answers on two threads of one worker: their retrievals never
    overlap, and their generations must, since each waits for the other at a
    barrier that breaks after five seconds. A lock widened over generation
    breaks it; a lock deleted lets two retrievals in at once.

    The retrieval sleeps rather than returning at once on purpose: with no
    work inside the critical section, threads would serialise by accident and
    the test would pass against a missing lock.
    """
    guard = threading.Lock()
    inside = [0]
    peak = [0]

    def counted_search(*_args: object, **_kwargs: object) -> list[object]:
        with guard:
            inside[0] += 1
            peak[0] = max(peak[0], inside[0])
        time.sleep(0.05)
        with guard:
            inside[0] -= 1
        return []

    both_generating = threading.Barrier(2, timeout=5)

    def side_by_side(*_args: object) -> Iterator[str]:
        both_generating.wait()
        yield "An answer."

    decision = RouteDecision.model_validate_json(SLIDES_ROUTE)
    monkeypatch.setattr(engine_module, "route", lambda *_args: decision)
    monkeypatch.setattr(engine_module, "search", counted_search)
    monkeypatch.setattr(engine_module, "answer", side_by_side)
    engine = Engine(
        client=cast("QdrantClient", SimpleNamespace(collection_exists=lambda _name: True)),
        dense=StubDense(),
        sparse=StubSparse(),
        reranker=None,
        completer=ScriptedCompleter([]),
        streamer=ScriptedStreamer([]),
    )
    failures: list[BaseException] = []

    def answer_one() -> None:
        try:
            list(engine.stream("What is an ORM?", None, scope=None))
        except BaseException as exc:  # reported below, in the test's own thread
            failures.append(exc)

    threads = [threading.Thread(target=answer_one) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert peak[0] == 1


def test_two_first_questions_build_one_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """The lock covers the build: two questions taken by two threads before
    anything is loaded must not each pay for a reranker."""
    builds: list[int] = []
    built = cast("Engine", object())

    def slow_build() -> Engine:
        builds.append(1)
        time.sleep(0.05)
        return built

    monkeypatch.setattr(engine_module, "build_engine", slow_build)
    loaded: list[Engine] = []

    threads = [
        threading.Thread(target=lambda: loaded.append(engine_module.loaded_engine()))
        for _ in range(3)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(builds) == 1
    assert loaded == [built, built, built]


def test_a_failed_build_is_tried_again(monkeypatch: pytest.MonkeyPatch) -> None:
    """A service down while the worker starts is no reason to refuse every
    later question: the slot stays empty, and the next one builds again."""
    outcomes: list[Engine | Exception] = [EngineUnavailableError("down"), cast("Engine", object())]

    def build() -> Engine:
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(engine_module, "build_engine", build)

    with pytest.raises(EngineUnavailableError):
        engine_module.loaded_engine()
    engine = engine_module.loaded_engine()

    assert outcomes == []
    assert engine_module.loaded_engine() is engine
