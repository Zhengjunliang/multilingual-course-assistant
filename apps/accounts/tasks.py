"""The accounts' background tasks, run by a Celery worker (config/celery.py)."""

from django.core.management import call_command

from config.celery import app


@app.task
def clear_expired_sessions() -> None:
    """Deletes the sessions past their expiry: Django's `clearsessions`, nightly from beat.

    Django keeps an expired session's row until something deletes it, and
    asks for this command to be run regularly. It purges through
    `SESSION_ENGINE`, whose store keeps its rows in `AccountSession`
    (apps/accounts/sessions.py). Running it twice deletes nothing more, which
    is what a task acknowledged late has to allow.
    """
    call_command("clearsessions")
