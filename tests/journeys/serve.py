"""Start the site for the browser journeys (frontend/playwright.journeys.config.ts):

    python -m tests.journeys.serve 8017   # from the repository root, the SPA built

Django's own `testserver` command, with the demo in place of its fixtures: a
test database created afresh (`mca_journeys`, tests/journeys/settings.py),
`populate_demo` run into it, and `runserver` on top. `--insecure` because DEBUG
stays off, as in the configuration CI checks, and with DEBUG off Django serves
no static files otherwise (config/settings.py, section "Static files").

Questions are answered, and uploads ingested, by a Celery worker this process
starts beside the server, on the `qa` and `ingest` queues (apps/qa/tasks.py,
apps/materials/tasks.py), through a broker in memory: one process, so the
worker answers from the same database and the same stub index the ingest
writes into, and no broker the developer runs hands a run's tasks to their
own worker, which would answer from the real index.
"""

import os
import sys

import django
from celery.contrib.testing.worker import start_worker
from django.core.management import call_command
from django.db import connection

if __name__ == "__main__":
    # Not a default: a shell exporting `config.settings` would otherwise start
    # the real models against the real index.
    os.environ["DJANGO_SETTINGS_MODULE"] = "tests.journeys.settings"
    # Read by Celery ahead of its settings (celery/app/utils.py).
    os.environ["CELERY_BROKER_URL"] = "memory://"
    django.setup()
    connection.creation.create_test_db(verbosity=0, autoclobber=True, serialize=False)
    call_command("populate_demo", verbosity=0)

    from config.celery import app

    # Solo, as on a Windows worker; no ping, which needs a task the app lacks.
    worker = start_worker(app, pool="solo", perform_ping_check=False, queues=["qa", "ingest"])
    # Celery annotates the context manager as the iterable it was written as.
    with worker:  # pyright: ignore[reportGeneralTypeIssues]
        call_command(
            "runserver",
            f"127.0.0.1:{sys.argv[1]}",
            use_reloader=False,
            insecure_serving=True,
        )
