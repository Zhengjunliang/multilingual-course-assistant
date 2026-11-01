"""The superuser's page of background work: `GET /api/admin/activity`, a stream of events.

The page draws the questions and the uploads going through Redis and the
Celery workers (#236). It opens on a `snapshot`: the global cap and the places
taken under it (apps/qa/inflight.py), the workers online
(apps/system/workers.py), and every entry of the last tasks on the activity
stream (apps/system/activity.py). Then each entry written after those, as an
`activity` event under its stream id, and every `REFRESH_SECONDS` a `refresh`
with the places and the workers again, since a lease that runs out and a
worker that goes away write no entry. apps/system/contract.py owns the shapes.

**For the superuser alone**, as the ratings page is (apps/qa/feedback_views.py):
the entries name no asker, and a question is its opening words.

**Nothing to resume.** A reader who lost the connection opens the feed again
and reads a new snapshot, which already holds what it missed; `Last-Event-ID`
is not read. A Redis that fails mid-feed ends it, for the page to open it again.

**Under WSGI an open feed holds a thread**, as an answer's stream does
(apps/qa/views.py): one per page open, and the page is a superuser's. A
reader who left is noticed at the next keepalive, which a quiet feed sends
every `READ_BLOCK_SECONDS` (apps/system/activity.py).
"""

from __future__ import annotations

import contextvars
import logging
import time
from typing import TYPE_CHECKING

from django.conf import settings
from redis.exceptions import RedisError
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperuser
from apps.qa import inflight
from apps.qa.contract import KEEPALIVE, sse
from apps.qa.views import RETRY_AFTER_SECONDS, ServerSentEventRenderer, streaming
from apps.system import activity
from apps.system.contract import ActivityEntry, Refresh, Seat, Snapshot
from apps.system.workers import online
from config.env import env

if TYPE_CHECKING:
    from collections.abc import Generator

    from django.http import StreamingHttpResponse
    from rest_framework.request import Request

logger = logging.getLogger(__name__)

# How often the places and the workers are sent again. Asking the workers
# takes two broadcasts (apps/system/workers.py), so not at every keepalive.
REFRESH_SECONDS = 15.0


def _seats() -> list[Seat]:
    return [Seat(answer_id=answer_id, taken=taken) for answer_id, taken in inflight.seats()]


def _trace_url() -> str | None:
    """Where a trace opens once its id is appended: Langfuse's own route that
    finds a trace's project by its id (`/trace/<id>`, outside the repository),
    so the page needs no project id. Only with tracing on."""
    if not env.langfuse_tracing_enabled:
        return None
    return f"{env.langfuse_base_url.rstrip('/')}/trace/"


class _Feed:
    """The response body, run in a copy of the view's context so that its log
    lines name the request: the reason the answer's relay gives
    (apps/qa/views.py, `_Relay`)."""

    def __init__(self) -> None:
        self._context = contextvars.copy_context()
        self._frames = self._framed()

    def __iter__(self) -> _Feed:
        return self

    def __next__(self) -> str:
        return self._context.run(next, self._frames)

    def close(self) -> None:
        self._context.run(self._frames.close)

    def _framed(self) -> Generator[str, None, None]:
        try:
            recent, after = activity.recent()
            snapshot = Snapshot(
                cap=settings.QA_MAX_IN_FLIGHT,
                retry_after_seconds=RETRY_AFTER_SECONDS,
                trace_url=_trace_url(),
                seats=_seats(),
                workers=online(),
                recent=recent,
            )
            yield sse(Snapshot.NAME, snapshot.model_dump_json())
            refreshed = time.monotonic()
            while True:
                entries = activity.read(after, block=activity.READ_BLOCK_SECONDS)
                for entry in entries:
                    after = entry.id
                    yield sse(ActivityEntry.NAME, entry.model_dump_json(), entry.id)
                if time.monotonic() - refreshed >= REFRESH_SECONDS:
                    refreshed = time.monotonic()
                    yield sse(
                        Refresh.NAME, Refresh(seats=_seats(), workers=online()).model_dump_json()
                    )
                elif not entries:
                    yield KEEPALIVE
        except RedisError:
            logger.exception("the activity feed could not be read")


class ActivityView(APIView):
    """GET the background work as it happens: `text/event-stream`, one
    `snapshot`, then `activity` and `refresh` events, never an end of its own."""

    # As apps/qa/views.py's: JSON first for the error bodies, the SSE framing
    # for a client that asks for the stream.
    renderer_classes = (JSONRenderer, ServerSentEventRenderer)
    permission_classes = (IsAuthenticated, IsSuperuser)

    def get(self, request: Request) -> StreamingHttpResponse:
        return streaming(_Feed())
