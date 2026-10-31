"""App registration.

`default_auto_field` is deliberately absent: `DEFAULT_AUTO_FIELD` in
config/settings.py already covers every app, and repeating it here would be a
second place to keep in sync.
"""

from django.apps import AppConfig


class QaConfig(AppConfig):
    name = "apps.qa"

    def ready(self) -> None:
        # Connects the conversation's `pre_delete`, in every process that can
        # delete one, the web's included.
        from apps.qa import traces  # noqa: F401
