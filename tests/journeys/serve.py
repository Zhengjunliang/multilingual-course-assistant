"""Start the site for the browser journeys (frontend/playwright.journeys.config.ts):

    python -m tests.journeys.serve 8017   # from the repository root, the SPA built

Django's own `testserver` command, with the demo in place of its fixtures: a
test database created afresh (`mca_journeys`, tests/journeys/settings.py),
`populate_demo` run into it, and `runserver` on top. `--insecure` because DEBUG
stays off, as in the configuration CI checks, and with DEBUG off Django serves
no static files otherwise (config/settings.py, section "Static files").
"""

import os
import sys

import django
from django.core.management import call_command
from django.db import connection

if __name__ == "__main__":
    # Not a default: a shell exporting `config.settings` would otherwise start
    # the real models against the real index.
    os.environ["DJANGO_SETTINGS_MODULE"] = "tests.journeys.settings"
    django.setup()
    connection.creation.create_test_db(verbosity=0, autoclobber=True, serialize=False)
    call_command("populate_demo", verbosity=0)
    call_command(
        "runserver",
        f"127.0.0.1:{sys.argv[1]}",
        use_reloader=False,
        insecure_serving=True,
    )
