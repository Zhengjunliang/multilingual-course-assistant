"""The staff roles, as code.

The roles are fixed by the thesis design — a teacher of a course edition,
secretariat staff of a degree programme — so they are a list in code rather
than rows an administrator edits, the way Sentry fixes its organisation roles
in `SENTRY_ROLES`. A `RoleAssignment` row (`apps/roles/models.py`) stores only
who holds which of them on which scope. The administrator is Django's
`is_superuser` and is not a role here.
"""

from django.db import models
from django.utils.translation import gettext_lazy as _


class Role(models.TextChoices):
    TEACHER = "teacher", _("teacher")
    SECRETARIAT = "secretariat", _("secretariat staff")
