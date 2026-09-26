"""App registration.

`default_auto_field` is deliberately absent: `DEFAULT_AUTO_FIELD` in
config/settings.py already covers every app, and repeating it here would be a
second place to keep in sync.
"""

from django.apps import AppConfig


class CatalogConfig(AppConfig):
    name = "apps.catalog"
