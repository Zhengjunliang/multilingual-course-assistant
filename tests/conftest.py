"""Process-wide state that must not travel between tests, and the one request no test may send.

Two things in this project outlive a single request on purpose: the engine slot
(apps/qa/engine.py, one set of models per process) and the throttle counters
(Django's local-memory cache, which is what makes a per-process rate limit
possible at all). Both are correct in production and both are contamination in a
test suite.

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

import httpx
import pytest
from django.core.cache import cache
from pwned_passwords_django import api

from apps.qa import engine as engine_module


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
