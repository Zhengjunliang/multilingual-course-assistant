"""The site the browser journeys run against (frontend/playwright.journeys.config.ts):
config/settings.py with the retrieval swapped for stubs, a database of its own,
and rate limits a whole suite from one address fits under.

The limits themselves are tested where they are cheap to drive,
tests/test_accounts_api.py and tests/test_qa_api.py; here they would only turn a
setup that logs in twice and a run repeated five times into 429s.
"""

from config.settings import *  # noqa: F403
from config.settings import DATABASES, REST_FRAMEWORK

QA_RETRIEVAL = "tests.journeys.retrieval.build_retrieval"

# Created afresh by tests/journeys/serve.py on every run, beside the developer's
# `mca` and pytest's `test_mca*`, neither of which a run touches.
DATABASES = {"default": {**DATABASES["default"], "TEST": {"NAME": "mca_journeys"}}}

REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {"ask": "1000/min", "auth": "1000/min"},
}
