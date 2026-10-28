"""The project's user model, and the sessions signed in to it.

Swapped in before the first `migrate` on purpose: `contrib.auth` and `admin`
declare their dependency on the user model through `swappable_dependency`, so a
custom model has to exist and be migrated for those dependencies to resolve.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.contrib.sessions.base_session import AbstractBaseSession
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.accounts.sessions import USER_AGENT_MAX_LENGTH, SessionStore


class User(AbstractUser):
    """`AbstractUser` plus the one field the domain forces on every model.

    Questions arrive in any language and are answered in that same language, so
    nothing user-facing may assume a single one. `locale` is the account's
    preference — it drives the interface and breaks the tie when a question
    carries no language signal of its own. Per-question detection stays in
    `rag/`, which knows nothing about this model.
    """

    locale = models.CharField(
        max_length=16,
        choices=settings.LANGUAGES,
        default=settings.LANGUAGE_CODE,
        verbose_name=_("preferred language"),
        help_text=_("Language for the interface and for generated answers."),
    )


class AccountSession(AbstractBaseSession):
    """A session, saved by the engine of apps/accounts/sessions.py.

    Every column past Django's three is projected from the session's data on
    each save; none is written on its own. A session nobody signed in to has
    no `user`, and is a visitor's.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE, related_name="sessions"
    )
    user_agent = models.CharField(max_length=USER_AGENT_MAX_LENGTH, blank=True)
    ip = models.GenericIPAddressField(null=True)
    authenticated_at = models.DateTimeField(null=True)
    last_activity = models.DateTimeField(null=True)

    # The column Django adds for the key, declared for the type checker, which
    # does not see it: the engine sets the key it reads off the session's data.
    user_id: int | None

    @classmethod
    def get_session_store_class(cls) -> type[SessionStore]:
        return SessionStore
