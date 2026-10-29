"""The site the browser journeys run against (frontend/playwright.journeys.config.ts):
config/settings.py with the retrieval swapped for stubs, a database of its own,
rate limits a whole suite from one address fits under, counted apart from the
developer's own site, and no request to Pwned Passwords.

The limits themselves are tested where they are cheap to drive,
tests/test_accounts_api.py and tests/test_qa_api.py; here they would only turn a
setup that logs in twice and a run repeated five times into 429s. The
breached-password check is tested there too, against a fake range
(tests/conftest.py); here every registration and the demo's seeding would send
it out of the machine.
"""

from config.settings import *  # noqa: F403
from config.settings import AUTH_PASSWORD_VALIDATORS, CACHES, DATABASES, REST_FRAMEWORK

QA_RETRIEVAL = "tests.journeys.retrieval.build_retrieval"

# Created afresh by tests/journeys/serve.py on every run, beside the developer's
# `mca` and pytest's `test_mca*`, neither of which a run touches.
DATABASES = {"default": {**DATABASES["default"], "TEST": {"NAME": "mca_journeys"}}}

REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {"ask": "1000/min", "auth": "1000/min"},
}

# The developer's site counts in the same Redis database, from the same
# address: without a prefix of the run's own, a run's logins would leave that
# site refusing the developer's for a minute.
CACHES = {"default": {**CACHES["default"], "KEY_PREFIX": "journeys"}}

# The answers in flight count apart for the same reason, under a cap no run
# reaches: what a journey tests is the page, and the cap is tests/test_qa_api.py's.
QA_KEY_PREFIX = "journeys:qa"
QA_MAX_IN_FLIGHT = 1000

# The worker tests/journeys/serve.py starts looks for a question every tenth of
# a second, where the in-memory broker's default is every second.
CELERY_BROKER_TRANSPORT_OPTIONS = {"polling_interval": 0.1}

AUTH_PASSWORD_VALIDATORS = [
    validator
    for validator in AUTH_PASSWORD_VALIDATORS
    if not validator["NAME"].startswith("pwned_passwords_django.")
]
