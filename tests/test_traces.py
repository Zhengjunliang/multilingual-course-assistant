"""What Langfuse is told about the site's answers (apps/qa/tasks.py) and how it
is kept in step with the database (apps/qa/traces.py).

An answer's trace is recorded in memory (`traced`, tests/conftest.py), by the
real SDK, from a question asked at the endpoint, as tests/test_qa_api.py asks
them. Langfuse's REST side is `FakeLangfuse`: the lists it pages through, the
deletions and the scores it is sent, so the tasks that talk to it run whole
and nothing listens at a port.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import uuid
from collections.abc import Callable, Iterator
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from opentelemetry.sdk.trace import ReadableSpan
from pydantic import SecretStr
from test_conversation_list import client, owner, started
from test_index import StubDense, StubSparse, make_chunk
from test_llm import RecordingCompletions, attributes, serve
from test_qa_api import ORM_TEXT, SLIDES_ROUTE, answer, ask, events, install_engine

from apps.accounts.models import User
from apps.qa import engine as engine_module
from apps.qa import traces
from apps.qa import views as views_module
from apps.qa.models import Conversation, Feedback, Message
from config.env import env
from rag.index import ensure_collection, index_chunks, open_client
from rag.llm import build_streamer

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.django_db

Spans = Callable[[], tuple[ReadableSpan, ...]]


@pytest.fixture
def tracing_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(env, "langfuse_tracing_enabled", True)


# The answer's trace


@pytest.fixture
def engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """The stub engine of tests/test_qa_api.py, generating through the real
    client against a fake server, so that the answer is a generation too. Its
    worker runs in the test's thread, as there."""
    qdrant = open_client(tmp_path / "qdrant")
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    serve(monkeypatch, RecordingCompletions(deltas=("An ORM ", "maps objects.")))
    streamer = build_streamer("http://x/v1", SecretStr("k"), "qwen3:4b")
    engine_module._HOLDER.engine = dataclasses.replace(
        install_engine(qdrant, SLIDES_ROUTE), streamer=streamer
    )
    monkeypatch.setattr(views_module, "enqueue", answer)
    yield
    qdrant.close()


def test_a_signed_in_answer_is_one_trace_that_names_nobody(engine: None, traced: Spans) -> None:
    """Found by the request id the answer row keeps and grouped by its
    conversation, the question in and the answer out, its four steps under
    it: the route, the wait for the GPU, the search and the generation."""
    events(ask())

    spans = traced()
    (root,) = [span for span in spans if span.name == traces.SITE_TRACE]
    stored = Message.objects.get(role=Message.Role.ASSISTANT)
    assert root.context is not None
    assert format(root.context.trace_id, "032x") == stored.request_id
    assert attributes(root)["session.id"] == str(stored.conversation_id)
    assert attributes(root)["langfuse.observation.input"] == "What is an ORM?"
    assert attributes(root)["langfuse.observation.output"] == "An ORM maps objects."
    steps = {span.name: attributes(span) for span in spans if span is not root}
    assert {span.parent.span_id for span in spans if span is not root and span.parent} == {
        root.context.span_id
    }
    assert set(steps) == {"RouteDecision", "gpu-wait", "retrieve", "answer"}
    assert steps["retrieve"]["langfuse.observation.type"] == "retriever"
    assert steps["retrieve"]["langfuse.observation.input"] == "orm"
    (hit,) = json.loads(steps["retrieve"]["langfuse.observation.output"])
    assert hit["marker"] == "[deck.pdf p.1]"
    assert not [span for span in spans if "user.id" in attributes(span)]


def test_a_visitors_answer_is_recorded_nowhere(engine: None, traced: Spans) -> None:
    """Not as a trace, and not as a call either: a call is recorded only
    inside a trace, and a visitor's answer opens none."""
    assert events(ask(anonymous=True, history=[]))[-1][0] == "end"
    assert traced() == ()


# What a deletion and a rating queue


@pytest.fixture
def queued(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, tuple[object, ...]]]:
    """The tasks queued, by name, with their arguments."""
    sent: list[tuple[str, tuple[object, ...]]] = []
    monkeypatch.setattr(traces, "_queue", lambda task, *args: sent.append((task.name, args)))
    return sent


def answered(conversation: Conversation, request_id: str) -> Message:
    """Its answer, given the request id a worker writes with it."""
    Message.objects.filter(conversation=conversation, role=Message.Role.ASSISTANT).update(
        request_id=request_id
    )
    return Message.objects.get(conversation=conversation, role=Message.Role.ASSISTANT)


DELETIONS: dict[str, Callable[[Conversation], object]] = {
    # apps/qa/conversation_views.py
    "its-own": lambda conversation: client().delete(f"/api/conversations/{conversation.pk}"),
    # Both account deletions of apps/accounts/services.py end in this.
    "its-owners-account": lambda conversation: owner().delete(),
    # The admin's bulk action deletes a queryset.
    "the-admins-bulk": lambda conversation: Conversation.objects.filter(
        pk=conversation.pk
    ).delete(),
}


@pytest.mark.usefixtures("tracing_on")
@pytest.mark.parametrize("deletion", DELETIONS.values(), ids=DELETIONS.keys())
def test_every_deletion_of_a_conversation_forgets_its_traces_once_committed(
    deletion: Callable[[Conversation], object],
    queued: list[tuple[str, tuple[object, ...]]],
    django_capture_on_commit_callbacks: Callable[..., Any],
) -> None:
    """Each answer's trace is named by its request id; a question has none,
    and another student's conversation is not touched."""
    mine = started(0)
    answered(mine, "a" * 32)
    other = Conversation.objects.create(owner=User.objects.create(username="other"), locale="it")

    with django_capture_on_commit_callbacks(execute=True):
        deletion(mine)
        assert queued == []

    assert queued == [("apps.qa.traces.forget_traces", (["a" * 32],))]
    assert Conversation.objects.filter(pk=other.pk).exists()


def test_with_tracing_off_nothing_is_queued(
    queued: list[tuple[str, tuple[object, ...]]],
    django_capture_on_commit_callbacks: Callable[..., Any],
) -> None:
    rated = answered(started(0), "a" * 32)
    with django_capture_on_commit_callbacks(execute=True):
        client().put(f"/api/answers/{rated.pk}/feedback", {"rating": "up"}, format="json")
        client().delete(f"/api/conversations/{rated.conversation_id}")
    assert queued == []


@pytest.mark.usefixtures("tracing_on")
def test_a_rating_put_or_withdrawn_queues_its_score(
    queued: list[tuple[str, tuple[object, ...]]],
    django_capture_on_commit_callbacks: Callable[..., Any],
) -> None:
    """A withdrawal of nothing changes nothing, and queues nothing."""
    rated = answered(started(0), "a" * 32)
    url = f"/api/answers/{rated.pk}/feedback"

    with django_capture_on_commit_callbacks(execute=True):
        client().put(url, {"rating": "down"}, format="json")
        client().delete(url)
        client().delete(url)
        assert queued == []

    assert queued == [("apps.qa.traces.sync_feedback_score", (str(rated.pk),))] * 2


# Langfuse's side


PAGE = 2


def paged(rows: list[Any], cursor: str | None) -> SimpleNamespace:
    """A page of `PAGE` rows and the cursor to the next, absent on the last."""
    start = int(cursor or 0)
    more = start + PAGE < len(rows)
    return SimpleNamespace(
        data=rows[start : start + PAGE],
        meta=SimpleNamespace(cursor=str(start + PAGE) if more else None),
    )


@dataclasses.dataclass
class FakeLangfuse:
    """The client calls the tasks make, served from two lists: the
    observations of the traces it holds and its scores. `sent` records every
    write."""

    observations: list[SimpleNamespace] = dataclasses.field(default_factory=list)
    scores: list[SimpleNamespace] = dataclasses.field(default_factory=list)
    sent: list[tuple[str, Any]] = dataclasses.field(default_factory=list)

    def __post_init__(self) -> None:
        self.api = SimpleNamespace(
            observations=SimpleNamespace(get_many=self.list_observations),
            scores=SimpleNamespace(
                get_many=self.list_scores,
                delete=lambda score_id: self.sent.append(("delete_score", score_id)),
            ),
            trace=SimpleNamespace(
                delete_multiple=lambda trace_ids: self.sent.append(("delete_traces", trace_ids))
            ),
        )

    def list_observations(
        self,
        *,
        cursor: str | None = None,
        name: str | None = None,
        is_root_observation: bool | None = None,
        trace_id: str | None = None,
        **_query: object,
    ) -> SimpleNamespace:
        rows = [
            observation
            for observation in self.observations
            if name in (None, observation.name)
            and is_root_observation in (None, observation.is_root)
            and trace_id in (None, observation.trace_id)
        ]
        return paged(rows, cursor)

    def list_scores(self, *, name: str, source: str, cursor: str | None, **_query: object) -> Any:
        assert (name, source) == (traces.SCORE, "API")
        return paged(self.scores, cursor)

    def create_score(self, **score: Any) -> None:
        self.sent.append(("create_score", score))

    def flush(self) -> None:
        self.sent.append(("flush", None))


def root(trace_id: str, session: str, name: str = traces.SITE_TRACE) -> SimpleNamespace:
    return SimpleNamespace(trace_id=trace_id, session_id=session, name=name, is_root=True)


def step(trace_id: str, session: str, name: str = "RouteDecision") -> SimpleNamespace:
    """An observation under a trace's root, which carries its session too."""
    return SimpleNamespace(trace_id=trace_id, session_id=session, name=name, is_root=False)


def score(answer: Message, value: bool, comment: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=traces.score_id(answer.pk), value=value, comment=comment)


@pytest.fixture
def langfuse(monkeypatch: pytest.MonkeyPatch) -> FakeLangfuse:
    fake = FakeLangfuse()
    monkeypatch.setattr("rag.llm.tracer", lambda: fake)
    return fake


def created(fake: FakeLangfuse) -> dict[str, dict[str, Any]]:
    return {score["score_id"]: score for kind, score in fake.sent if kind == "create_score"}


def test_a_rating_is_a_score_on_its_answers_trace_named_and_dated_by_the_answer(
    langfuse: FakeLangfuse,
) -> None:
    """Rated down, then up: the same id and the same date both times, so the
    second replaces the first. The date is the answer's, not the rating's: a
    rating withdrawn and given again is a row of another date, and Langfuse
    keeps a score under its id and its date."""
    rated = answered(started(0), "a" * 32)
    langfuse.observations = [root("a" * 32, str(rated.conversation_id))]
    Feedback.objects.create(
        answer=rated, rating="down", reason="other", comment="Off.", locale="en"
    )

    traces.sync_feedback_score(str(rated.pk))
    Feedback.objects.filter(answer=rated).update(rating="up", reason="", comment="", locale="")
    traces.sync_feedback_score(str(rated.pk))

    down, up = [score for kind, score in langfuse.sent if kind == "create_score"]
    assert down == {
        "name": "user-feedback",
        "value": 0.0,
        "data_type": "BOOLEAN",
        "trace_id": "a" * 32,
        "score_id": f"feedback-{rated.pk}",
        "comment": "other: Off.",
        "timestamp": rated.created_at,
    }
    assert up == {**down, "value": 1.0, "comment": None}
    assert [kind for kind, _ in langfuse.sent] == ["create_score", "flush"] * 2


def test_a_rating_withdrawn_or_of_an_answer_with_no_trace_sends_no_score(
    langfuse: FakeLangfuse,
) -> None:
    """With no trace yet, the score waits for the reconciliation; once the
    rating is gone, its score goes."""
    rated = answered(started(0), "a" * 32)
    Feedback.objects.create(answer=rated, rating="up")

    traces.sync_feedback_score(str(rated.pk))
    Feedback.objects.all().delete()
    traces.sync_feedback_score(str(rated.pk))

    assert langfuse.sent == [("delete_score", f"feedback-{rated.pk}")]


def test_the_reconciliation_corrects_langfuse_to_the_database(langfuse: FakeLangfuse) -> None:
    """The traces of a conversation that is gone are deleted, once each, and
    its session's alone: a trace with no session, as a CLI run's are, is
    not the site's. One whose root never reached Langfuse goes too, by its
    steps. Then the scores: one whose rating was withdrawn goes, one that
    disagrees is sent again, a missing one is sent, one that agrees is left
    alone, and an answer with no trace gets none. Every list is read past its
    first page."""
    kept, unchanged, missing = (answered(started(n), f"{n}" * 32) for n in range(3))
    untraced = answered(started(3), "3" * 32)
    withdrawn = answered(started(4), "4" * 32)
    gone = uuid.uuid4()
    langfuse.observations = [
        *(root(m.request_id, str(m.conversation_id)) for m in (kept, unchanged, missing)),
        root("5" * 32, str(gone)),
        step("5" * 32, str(gone)),
        root("6" * 32, str(gone)),
        root("7" * 32, "not-a-conversation"),
        # Its worker died after the route, before the root was exported.
        step("a" * 32, str(gone)),
        root("8" * 32, ""),
        root("9" * 32, "", name="routing"),
        step("9" * 32, ""),
    ]
    for rated in (kept, unchanged, missing, untraced):
        Feedback.objects.create(answer=rated, rating="up")
    langfuse.scores = [score(kept, False), score(unchanged, True), score(withdrawn, True)]

    traces.reconcile_traces()

    assert langfuse.sent[0] == ("delete_traces", ["5" * 32, "6" * 32, "7" * 32, "a" * 32])
    assert ("delete_score", traces.score_id(withdrawn.pk)) in langfuse.sent
    assert set(created(langfuse)) == {traces.score_id(kept.pk), traces.score_id(missing.pk)}
    assert langfuse.sent[-1] == ("flush", None)


def test_with_tracing_off_no_task_reaches_langfuse(monkeypatch: pytest.MonkeyPatch) -> None:
    def unreachable() -> None:
        raise AssertionError("tracing is off")

    monkeypatch.setattr("rag.llm.tracer", lambda: None)
    monkeypatch.setattr(traces, "_reconcile", unreachable)
    traces.reconcile_traces()
    traces.forget_traces(["a" * 32])
    traces.sync_feedback_score(str(uuid.uuid4()))


def test_langfuse_out_of_reach_is_one_line_for_the_next_run_to_catch_up(
    langfuse: FakeLangfuse, caplog: pytest.LogCaptureFixture
) -> None:
    def refused(**_query: object) -> None:
        raise httpx.ConnectError("refused")

    langfuse.api.observations.get_many = refused
    with caplog.at_level(logging.WARNING, logger="apps.qa.traces"):
        traces.reconcile_traces()
    assert [record.getMessage() for record in caplog.records] == [
        "Langfuse did not respond (refused); the next reconciliation catches up"
    ]
