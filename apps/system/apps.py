"""App registration; apps/qa/apps.py says why `default_auto_field` is absent."""

from django.apps import AppConfig


class SystemConfig(AppConfig):
    name = "apps.system"
