"""The superuser's page of background work, read as the page reads it (apps/system/views.py).

The feed against the real Redis, as tests/test_inflight.py reads the answers
in flight: the snapshot it opens on, the entries after it, its keepalives and
refreshes. Then what the snapshot is made of: the last tasks of the activity
stream (apps/system/activity.py) and the workers' replies to `inspect`
(apps/system/workers.py), which no test broadcasts for real: the feed's
workers are a fixed laptop, and the replies a stand-in for Celery's.

Who may open the feed is tests/access_matrix.txt's: the superuser, nobody else.
"""

from __future__ import annotations

import itertools
import json
import uuid
from typing import TYPE_CHECKING, Any

import pytest
from django.urls import reverse
from kombu.exceptions import OperationalError
from test_catalog_api import as_user
from test_inflight import admit, queued

from apps.accounts.models import User
from apps.accounts.sessions import end_sessions
from apps.materials.models import MaterialStatus
from apps.qa import inflight
from apps.system import activity, views, workers
from apps.system.contract import Worker
from config.celery import app
from config.env import env

if TYPE_CHECKING:
    from collections.abc import Iterator

    from pytest_django import Settings

pytestmark = pytest.mark.django_db

URL = reverse("system:activity")

LAPTOP = Worker(
    hostname="celery@laptop", queues=["default", "ingest", "qa"], pool="solo", concurrency=1
)


@pytest.fixture(autouse=True)
def _one_laptop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(views, "online", lambda: [LAPTOP])


def feed() -> Iterator[tuple[str | None, str, Any]]:
    """The feed a superuser opens, frame by frame: `(id, event, data)`, and
    `(None, "", None)` for a keepalive."""
    root = User.objects.create_superuser(username="root", password=None)
    response: Any = as_user(root).get(URL)
    assert response["Content-Type"] == "text/event-stream"
    for chunk in response.streaming_content:
        frame = chunk.decode()
        if frame.startswith(":"):
            yield None, "", None
            continue
        lines = dict(line.split(": ", 1) for line in frame.strip().splitlines())
        yield lines.get("id"), lines["event"], json.loads(lines["data"])


def test_the_feed_opens_on_the_cap_its_places_the_workers_and_the_last_tasks(
    settings: Settings,
) -> None:
    settings.QA_MAX_IN_FLIGHT = 3
    waiting, answering = admit(), admit()
    inflight.take(answering)
    activity.record_upload(7, MaterialStatus.QUEUED, file="Lezione 08.pdf")

    _id, name, snapshot = next(feed())

    assert name == "snapshot"
    assert (snapshot["cap"], snapshot["retry_after_seconds"], snapshot["trace_url"]) == (
        3,
        60,
        None,
    )
    assert {seat["answer_id"]: seat["taken"] for seat in snapshot["seats"]} == {
        str(waiting): False,
        str(answering): True,
    }
    assert snapshot["workers"] == [LAPTOP.model_dump()]
    assert [(entry["task"], entry["event"]) for entry in snapshot["recent"]] == [
        (str(waiting), "queued"),
        (str(answering), "queued"),
        (str(answering), "taken"),
        ("7", "queued"),
    ]


def test_the_feed_relays_each_entry_written_after_its_snapshot() -> None:
    activity.record_upload(7, MaterialStatus.QUEUED, file="Lezione 08.pdf")
    frames = feed()
    next(frames)

    activity.record_upload(7, MaterialStatus.PARSING)
    entry_id, name, entry = next(frames)

    assert (name, entry["task"], entry["event"]) == ("activity", "7", "parsing")
    assert entry_id == entry["id"]


def test_a_quiet_feed_keeps_its_connection_and_sends_the_places_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(activity, "READ_BLOCK_SECONDS", 0.01)
    frames = feed()
    next(frames)

    assert next(frames) == (None, "", None)

    monkeypatch.setattr(views, "REFRESH_SECONDS", 0)
    answer_id = admit()
    # The admission's entry, then the refresh due after the read that found it.
    _id, read, _entry = next(frames)
    _id, name, refresh = next(frames)

    assert (read, name) == ("activity", "refresh")
    assert refresh == {
        "seats": [{"answer_id": str(answer_id), "taken": False}],
        "workers": [LAPTOP.model_dump()],
    }


@pytest.mark.parametrize("change", ["demoted", "deactivated", "signed out"])
def test_a_feed_ends_at_its_next_refresh_once_its_reader_may_no_longer_read_it(
    monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    monkeypatch.setattr(activity, "READ_BLOCK_SECONDS", 0.01)
    frames = feed()
    next(frames)
    root = User.objects.get(username="root")
    if change == "signed out":
        end_sessions(root)
    else:
        field = "is_superuser" if change == "demoted" else "is_active"
        User.objects.filter(pk=root.pk).update(**{field: False})

    monkeypatch.setattr(views, "REFRESH_SECONDS", 0)

    # A few frames at most: a feed that does not end would never give `list` back.
    assert list(itertools.islice(frames, 3)) == []


def test_with_tracing_on_the_feed_says_where_a_trace_opens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(env, "langfuse_tracing_enabled", True)
    monkeypatch.setattr(env, "langfuse_base_url", "http://127.0.0.1:3000/")

    _id, _name, snapshot = next(feed())

    assert snapshot["trace_url"] == "http://127.0.0.1:3000/trace/"


def test_the_last_tasks_are_those_written_last_each_one_whole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Read a page of two entries at a time, so that a task's first entry
    lies several pages behind its last."""
    monkeypatch.setattr(activity, "_PAGE", 2)
    for material, event in [
        (1, "queued"),
        (2, "queued"),
        (1, "parsing"),
        (3, "queued"),
        (2, "parsing"),
        (3, "parsing"),
        (2, "chunking"),
    ]:
        activity.record_upload(material, MaterialStatus(event))

    recent, newest = activity.recent(tasks=2)

    assert [(entry.task, entry.event) for entry in recent] == [
        ("2", "queued"),
        ("3", "queued"),
        ("2", "parsing"),
        ("3", "parsing"),
        ("2", "chunking"),
    ]
    assert newest == recent[-1].id


def test_an_empty_stream_has_no_task_and_is_read_from_its_start() -> None:
    assert activity.recent() == ([], "0-0")


class Replies:
    """What `app.control.inspect` hands back: each broadcast's replies, by hostname."""

    def __init__(self, queues: dict[str, Any] | None, stats: dict[str, Any] | None) -> None:
        self.queues, self.stats_ = queues, stats

    def active_queues(self) -> dict[str, Any] | None:
        return self.queues

    def stats(self) -> dict[str, Any] | None:
        return self.stats_


def pool(implementation: str, concurrency: int) -> dict[str, Any]:
    return {"pool": {"implementation": implementation, "max-concurrency": concurrency}}


def test_a_worker_is_drawn_from_its_replies_to_both_broadcasts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One that replied to only one has just taken a task: it is left to the
    entries of that task (apps/system/workers.py)."""
    replies = Replies(
        queues={
            "celery@micc-qa": [{"name": "qa"}],
            "celery@laptop": [{"name": "qa"}, {"name": "default"}, {"name": "ingest"}],
            "celery@busy": [{"name": "qa"}],
        },
        stats={
            "celery@micc-qa": pool("celery.concurrency.thread:TaskPool", 4),
            "celery@laptop": pool("celery.concurrency.solo:TaskPool", 1),
        },
    )
    monkeypatch.setattr(app.control, "inspect", lambda timeout: replies)

    assert workers.online() == [
        LAPTOP,
        Worker(hostname="celery@micc-qa", queues=["qa"], pool="threads", concurrency=4),
    ]


def test_no_worker_replying_or_no_broker_is_no_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app.control, "inspect", lambda timeout: Replies(None, None))
    assert workers.online() == []

    class Down(Replies):
        def active_queues(self) -> dict[str, Any] | None:
            raise OperationalError("the broker is down")

    monkeypatch.setattr(app.control, "inspect", lambda timeout: Down(None, None))
    assert workers.online() == []


def test_a_refused_question_is_a_task_of_its_own(settings: Settings) -> None:
    settings.QA_MAX_IN_FLIGHT = 1
    admitted = admit()
    refused = uuid.uuid4()
    inflight.admit(refused, queued(refused), owner=None, conversation_id=None)

    last, _newest = activity.recent(tasks=1)
    both, _newest = activity.recent()

    assert [(entry.task, entry.event) for entry in last] == [(str(refused), "refused")]
    assert [(entry.task, entry.event) for entry in both] == [
        (str(admitted), "queued"),
        (str(refused), "refused"),
    ]
