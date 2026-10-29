"""The Celery app: what `celery -A config worker` and `celery -A config beat` load.

Its configuration is the `CELERY_` section of config/settings.py, read
through Django's settings as Celery's Django guide does (outside the
repository), so a settings module that imports that file can override it.
The tasks live in each app's `tasks.py`, which `autodiscover_tasks` imports
when a worker starts.

The guide also has the project package import this app in its
`__init__.py`, so that `@shared_task` finds it. Not here: config/env.py is
read by rag/ too, which must load neither Django nor Celery, and importing
`config.env` runs `config/__init__.py` first. A task names this app instead
(`from config.celery import app`), and `-A config` finds this module by its name.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("config")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
