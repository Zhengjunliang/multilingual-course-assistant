"""App registration.

`default_auto_field` is deliberately absent: `DEFAULT_AUTO_FIELD` in
config/settings.py already covers every app, and repeating it here would be a
second place to keep in sync.
"""

from django.apps import AppConfig
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed

from apps.accounts import events


class AccountsConfig(AppConfig):
    name = "apps.accounts"

    def ready(self) -> None:
        # Connected in `ready`, where Django's documentation connects receivers,
        # each with a `dispatch_uid`: code that connects may run more than once,
        # and a receiver connected twice would log every event twice.
        user_logged_in.connect(events.logged_in, dispatch_uid="accounts.events.login")
        user_logged_out.connect(events.logged_out, dispatch_uid="accounts.events.logout")
        user_login_failed.connect(events.login_failed, dispatch_uid="accounts.events.failed")
