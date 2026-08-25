"""The project's user model.

Swapped in before the first `migrate` on purpose: `contrib.auth` and `admin`
declare their dependency on the user model through `swappable_dependency`, so a
custom model has to exist and be migrated for those dependencies to resolve.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _


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
