"""The `/api/admin/activity` wire contract: what the superuser's page of background work reads.

Pydantic, as the answer stream's contract is (apps/qa/contract.py), and framed
the same way: each model names the `event:` line it travels under. The feed is
one `snapshot`, then an `activity` event per entry written to the activity
stream (apps/system/activity.py), and a `refresh` every so often
(apps/system/views.py).

This module is the single source for those shapes; `frontend/src/api/system.ts`
mirrors it and tests/test_system_contract.py holds the two together.
"""

from __future__ import annotations

from typing import ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from apps.qa.contract import StepName

ActivityKind = Literal["question", "upload"]

# A question's events are its admission (`queued`, or `refused` at the cap),
# `taken` by a worker, and the answer stream's own events but the tokens
# (apps/qa/contract.py). An upload's are the statuses of its row, in the
# order its ingest reaches them (apps/materials/models.py, `MaterialStatus`).
ActivityEvent = Literal[
    "queued",
    "refused",
    "taken",
    "step",
    "start",
    "end",
    "stopped",
    "error",
    "parsing",
    "chunking",
    "indexing",
    "ready",
    "failed",
]


class ActivityEntry(BaseModel):
    """One thing that happened to a question or an upload.

    `id` is the entry's id in the activity stream, and the SSE id it travels
    under: its first part is the moment it was written, in milliseconds since
    the epoch, by Redis's clock. `task` is the answer's id for a question, the
    material's for an upload.

    The other fields belong to some events only, and are null on the rest:

    - `worker`, the hostname of the worker that wrote the entry, as Celery's
      `inspect` names it; null for one the site's own process wrote.
    - `question` and `request_id`, on `queued` and `refused`: a signed-in
      asker's question, cut short, and the id of the request that asked, which
      is the trace's id in Langfuse (apps/qa/tasks.py). A visitor's question
      is null: it is stored nowhere (apps/system/activity.py).
    - `step` and `ms`, on `step`: as `StepEvent`'s `name` and `ms`.
    - `found`, on `start`: how many excerpts the answer is written from.
    - `code`, on `error` and `failed`: the error's code (config/errors.py), or
      the material's failure (`MaterialFailure`).
    - `file`, on an upload's `queued`: the material's file name.
    - `chunks`, on `indexing`: how many passages the material was cut into.
    """

    model_config = ConfigDict(frozen=True)

    NAME: ClassVar[str] = "activity"

    id: str
    kind: ActivityKind
    task: str
    event: ActivityEvent
    worker: str | None = None
    question: str | None = None
    request_id: str | None = None
    step: StepName | None = None
    ms: int | None = None
    found: int | None = None
    code: str | None = None
    file: str | None = None
    chunks: int | None = None


class Worker(BaseModel):
    """A Celery worker online: the queues it consumes, its pool by the name
    `celery worker -P` takes, and how many tasks it runs at once."""

    model_config = ConfigDict(frozen=True)

    hostname: str
    queues: list[str]
    pool: str
    concurrency: int


class Seat(BaseModel):
    """A place taken under the global cap (apps/qa/inflight.py): by the answer
    `answer_id`, waiting for a worker or, once `taken`, being written."""

    model_config = ConfigDict(frozen=True)

    answer_id: UUID
    taken: bool


class Snapshot(BaseModel):
    """The feed's first event: what the page draws before any entry arrives.

    `cap` is the number of places (`QA_MAX_IN_FLIGHT`) and
    `retry_after_seconds` the wait a refused question is told
    (apps/qa/views.py). `trace_url`, with tracing on, is where a trace opens in
    Langfuse once its id is appended; null with tracing off. `recent` is every
    entry of the last tasks, oldest first (apps/system/activity.py).
    """

    model_config = ConfigDict(frozen=True)

    NAME: ClassVar[str] = "snapshot"

    cap: int
    retry_after_seconds: int
    trace_url: str | None
    seats: list[Seat]
    workers: list[Worker]
    recent: list[ActivityEntry]


class Refresh(BaseModel):
    """The places and the workers again, every so often: a lease that ran out
    and a worker that went away write no entry."""

    model_config = ConfigDict(frozen=True)

    NAME: ClassVar[str] = "refresh"

    seats: list[Seat]
    workers: list[Worker]
