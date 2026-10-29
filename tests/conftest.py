"""Process-wide state that must not travel between tests, and the one request no test may send.

Two things in this project outlive a single request on purpose: the engine slot
(apps/qa/engine.py, one set of models per process) and the throttle counters
(the Redis cache of config/settings.py, which every process of the site
shares). Both are correct in production and both are contamination in a test
suite.

The counters stay in Redis here too, the backend production runs, but each
pytest-xdist worker gets a Redis database of its own, as it gets a PostgreSQL
one: clearing the cache empties the whole database (FLUSHDB), and every worker
numbers its users from 1, so two workers on one database would wipe and fill
each other's buckets. Database 2 without xdist and 3 + N for worker gwN, clear of
the 0 and 1 of the developer's own site; Redis's sixteen are enough for the
four workers of scripts/check.py and for up to thirteen.

This lives in a conftest rather than in the file that first needed it because an
autouse fixture only applies to the module that defines it. A second test file
touching either — the account endpoints share the throttle cache with the
question endpoint — would otherwise inherit whatever the previous file left
behind, and which file that is depends on collection order.

The request is the breached-password check's (config/settings.py), which every
password set anywhere would send to api.pwnedpasswords.com.
"""

import hashlib
from collections.abc import Iterator
from urllib.parse import urlsplit

import httpx
import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from pwned_passwords_django import api

from apps.qa import engine as engine_module


@pytest.fixture(scope="session", autouse=True)
def _redis_database_of_its_own(worker_id: str) -> Iterator[None]:
    number = 2 if worker_id == "master" else 3 + int(worker_id.removeprefix("gw"))
    default = settings.CACHES["default"]
    location = urlsplit(default["LOCATION"])._replace(path=f"/{number}").geturl()
    with override_settings(CACHES={"default": {**default, "LOCATION": location}}):
        yield


@pytest.fixture(autouse=True)
def _fresh_process_state() -> Iterator[None]:
    engine_module._HOLDER.engine = None
    cache.clear()
    yield
    engine_module._HOLDER.engine = None
    cache.clear()


@pytest.fixture(autouse=True)
def leaked_passwords(monkeypatch: pytest.MonkeyPatch) -> set[str]:
    """The passwords the breached-password check finds; a test adds to it.

    Pwned Passwords answers a range, the hash suffixes it holds under the first
    five characters of a password's SHA-1, and this answers the same way from
    the set. Only the HTTP is replaced, through httpx's own `MockTransport` on
    the client the validator holds, so the library's hashing and parsing run as
    they do in production.
    """
    leaked: set[str] = set()

    def answer(request: httpx.Request) -> httpx.Response:
        prefix = request.url.path.rsplit("/", 1)[-1]
        digests = (
            hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
            for password in leaked
        )
        return httpx.Response(
            200, text="\n".join(f"{d[5:]}:3" for d in digests if d.startswith(prefix))
        )

    client = httpx.Client(transport=httpx.MockTransport(answer))
    monkeypatch.setattr(api.default_client, "client", client)
    return leaked
