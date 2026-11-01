"""The site's activity stream: what its background work is doing, for the superuser's page.

One Redis stream, `<QA_KEY_PREFIX>:activity` in the site's own database
(`REDIS_URL`), with an entry for each thing that happens to a question or an
upload: a question admitted or refused at the cap, taken by a worker, each of
its steps, its start and its end; an upload queued, and each step of its
ingest. The superuser's page reads it (apps/system/views.py), its last
entries when it opens and then each new one as it arrives. The fields of an
entry are `ActivityEntry`'s (apps/system/contract.py).

**Written by the site, where each thing happens.** A question's entries are
copies of its answer stream's events, written in the same step as each one
(apps/qa/inflight.py), so the page never shows an event the answer has not
had, nor misses one it had; an upload's are written beside each status its
row records (apps/materials/tasks.py). Neither Redis's `MONITOR`, which its
own documentation calls a debugging command that costs more than half the
server's throughput, nor Flower, a service of its own over Celery's events
(both outside the repository).

**What it leaves out.** An answer's tokens, which are the answer itself, and
anything that names the asker, as the ratings page names nobody
(apps/qa/feedback_serializers.py): a signed-in student's question is cut at
`QUESTION_CHARS`, and a visitor's is not written at all, as it is stored
nowhere else (apps/qa/views.py).

**How much.** The last `MAX_ENTRIES` entries, trimmed as Redis trims cheaply,
roughly: a question writes about ten, so the stream holds the last couple of
hundred tasks. Nothing else expires it.

**Watching never breaks the work.** A question's copy goes in the same
Redis step as the event it copies, which fails with it; an upload's entry is
written on its own, and a Redis that refuses it costs the entry, not the
ingest.

Its own redis-py client, as apps/qa/inflight.py has, on the same `REDIS_URL`:
that module writes entries into its own Redis steps, so this one cannot borrow
its client without the two importing each other.
"""

from __future__ import annotations

import functools
import logging
from typing import TYPE_CHECKING, cast

from celery import current_task
from django.conf import settings
from redis import Redis
from redis.exceptions import RedisError

from apps.qa.contract import ErrorEvent, StartEvent, StepEvent, TokenEvent
from apps.system.contract import ActivityEntry
from config.request_id import current

if TYPE_CHECKING:
    from uuid import UUID

    from celery import Task

    from apps.materials.models import MaterialStatus
    from apps.qa.contract import Event, QueuedEvent
    from apps.system.contract import ActivityKind

logger = logging.getLogger(__name__)

# About two hundred questions' worth of entries (the module's docstring),
# trimmed `MAXLEN ~`, redis-py's default for `xadd`.
MAX_ENTRIES = 2000

# A question's opening words: enough to tell two questions apart on the page.
QUESTION_CHARS = 200

# The tasks the page lists when it opens, as Flower and Sidekiq open on the
# last tasks (outside the repository).
RECENT_TASKS = 20

# How long a read waits for the next entry before returning empty-handed,
# which is how often the feed can send a keepalive (apps/system/views.py).
READ_BLOCK_SECONDS = 5.0

# How many entries `recent` reads at a time, newest first.
_PAGE = 200

# The events a task's entries begin with: once it is read, older entries
# hold nothing more of that task.
_FIRST = frozenset({"queued", "refused"})


@functools.lru_cache(maxsize=1)
def _connect(url: str) -> Redis:
    # A read blocks for READ_BLOCK_SECONDS by design, so the socket waits longer.
    return Redis.from_url(
        url, decode_responses=True, socket_connect_timeout=5, socket_timeout=READ_BLOCK_SECONDS + 5
    )


def _client() -> Redis:
    return _connect(settings.REDIS_URL)


def connected() -> bool:
    """Whether this process has opened the connection; tests clear only then."""
    return _connect.cache_info().currsize > 0


def key() -> str:
    """The stream's key."""
    return f"{settings.QA_KEY_PREFIX}:activity"


def _worker() -> str | None:
    """The worker writing the entry; None outside a task, in the site's own process."""
    # A proxy of the running task, false outside one; Celery leaves it unannotated.
    return cast("Task", current_task).request.hostname if current_task else None


def _fields(kind: ActivityKind, task: object, **extra: object) -> dict[str, str]:
    """An entry's fields, but its event's name; a field that is None is left out."""
    fields = {"kind": kind, "task": task, "worker": _worker(), **extra}
    return {name: str(value) for name, value in fields.items() if value is not None}


def asked(answer_id: UUID, event: QueuedEvent) -> dict[str, str]:
    """A question's admission, but its event's name: `queued` or `refused` is
    decided in the same Redis step that writes it (apps/qa/inflight.py). A
    visitor's question, which files no conversation, is left out."""
    signed_in = event.conversation_id is not None
    return _fields(
        "question",
        answer_id,
        question=event.question[:QUESTION_CHARS] if signed_in else None,
        request_id=current(),
    )


def taken(answer_id: UUID) -> dict[str, str]:
    """A question taken by the worker writing it."""
    return {"event": "taken", **_fields("question", answer_id)}


def mirrored(answer_id: UUID, event: Event) -> dict[str, str] | None:
    """The entry copying an answer's event; None for a token."""
    if isinstance(event, TokenEvent):
        return None
    extra: dict[str, object] = {}
    if isinstance(event, StepEvent):
        extra = {"step": event.name, "ms": event.ms}
    elif isinstance(event, StartEvent):
        extra = {"found": len(event.citations)}
    elif isinstance(event, ErrorEvent):
        extra = {"code": event.error.code}
    return {"event": type(event).NAME, **_fields("question", answer_id, **extra)}


def record_upload(
    material_id: int,
    event: MaterialStatus,
    *,
    file: str | None = None,
    chunks: int | None = None,
    code: str | None = None,
) -> None:
    """Write an upload's entry: a status its row has reached."""
    fields = {
        "event": str(event),
        **_fields("upload", material_id, file=file, chunks=chunks, code=code),
    }
    try:
        # redis-py wants a dict of its own unions, and a dict is invariant.
        _client().xadd(key(), fields, maxlen=MAX_ENTRIES)  # pyright: ignore[reportArgumentType]
    except RedisError:
        logger.exception("material %d: its %s entry was not written", material_id, event)


def _entries(replies: list[tuple[str, dict[str, str]]]) -> list[ActivityEntry]:
    return [
        ActivityEntry.model_validate({"id": entry_id, **fields}) for entry_id, fields in replies
    ]


def recent(tasks: int = RECENT_TASKS) -> tuple[list[ActivityEntry], str]:
    """Every entry of the last `tasks` tasks, oldest first, and the id of the
    stream's newest entry ("0-0" for an empty stream), after which a read
    finds what came since.

    The last tasks are the ones with the latest entries. The stream is read
    newest first until each of them has met its first entry, or the stream
    ends: a task begun before the oldest entry kept shows what is left of it.
    """
    client = _client()
    chosen: set[tuple[str, str]] = set()
    unopened: set[tuple[str, str]] = set()
    kept: list[ActivityEntry] = []
    newest = "0-0"
    upper = "+"
    while True:
        page = cast(
            "list[tuple[str, dict[str, str]]]", client.xrevrange(key(), upper, "-", count=_PAGE)
        )
        if not page:
            break
        if newest == "0-0":
            newest = page[0][0]
        for entry in _entries(page):
            task = (entry.kind, entry.task)
            if task not in chosen:
                if len(chosen) == tasks:
                    continue
                chosen.add(task)
                unopened.add(task)
            kept.append(entry)
            if entry.event in _FIRST:
                unopened.discard(task)
        if len(chosen) == tasks and not unopened:
            break
        upper = f"({page[-1][0]}"
    kept.reverse()
    return kept, newest


def read(after: str, *, block: float) -> list[ActivityEntry]:
    """The entries after `after`, waiting up to `block` seconds for the first;
    empty when none arrived."""
    replies = cast(
        "list[tuple[str, list[tuple[str, dict[str, str]]]]] | None",
        _client().xread({key(): after}, block=round(block * 1000)),
    )
    return [entry for _key, items in replies or () for entry in _entries(items)]
