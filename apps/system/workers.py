"""The Celery workers online, as the superuser's page draws them (apps/system/views.py).

Asked of the workers themselves through Celery's remote control (`inspect`),
which is how Flower lists them too (outside the repository): the queues each
consumes and its pool, from two broadcasts that wait `INSPECT_SECONDS` each
for the replies.

A worker on the solo pool, a Windows worker's, reads its remote control only
between two tasks, so it is missing from the replies while it works. The page
keeps it from the entries its task writes, which name it
(apps/system/activity.py).
"""

from __future__ import annotations

import logging
from typing import Any

from celery.concurrency import ALIASES

from apps.system.contract import Worker
from config.celery import app

logger = logging.getLogger(__name__)

# How long each broadcast waits for replies; the feed waits this long twice
# per refresh. An idle solo worker on a Windows laptop missed one 0.5 s wait
# in two, and none of 1 s (measured 1 November 2026).
INSPECT_SECONDS = 1.0


def online(timeout: float = INSPECT_SECONDS) -> list[Worker]:
    """The workers that replied, by hostname; none when the broker cannot be reached."""
    inspect = app.control.inspect(timeout=timeout)
    try:
        queues: dict[str, list[dict[str, Any]]] = inspect.active_queues() or {}
        stats: dict[str, dict[str, Any]] = inspect.stats() or {}
    except Exception:
        # The broker is down: the page shows no worker, and questions fail anyway.
        logger.warning("the workers could not be asked what they consume", exc_info=True)
        return []
    # A worker that replied to one broadcast and not the other has just
    # taken a task; it is drawn from that task's entries.
    return [
        Worker(
            hostname=hostname,
            queues=sorted(queue["name"] for queue in queues[hostname]),
            pool=_pool(stats[hostname]["pool"]["implementation"]),
            concurrency=stats[hostname]["pool"]["max-concurrency"],
        )
        for hostname in sorted(queues.keys() & stats.keys())
    ]


def _pool(implementation: str) -> str:
    """The name `celery worker -P` takes for a pool's class, its own path for
    one Celery does not name."""
    return next((name for name, path in ALIASES.items() if path == implementation), implementation)
