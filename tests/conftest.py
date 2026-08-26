"""Process-wide state that must not travel between tests.

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
"""

from collections.abc import Iterator

import pytest
from django.core.cache import cache

from apps.qa import engine as engine_module


@pytest.fixture(autouse=True)
def _fresh_process_state() -> Iterator[None]:
    engine_module._HOLDER.engine = None
    cache.clear()
    yield
    engine_module._HOLDER.engine = None
    cache.clear()
