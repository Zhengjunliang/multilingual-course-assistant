"""The staff roles and what each may do, as code.

The roles are fixed by the thesis design — a teacher of a course edition,
secretariat staff of a degree programme — so they and their permissions are
constants rather than rows an administrator edits, the way Sentry fixes its
organisation roles and their scopes in `SENTRY_ROLES` and openedx-authz defines
its roles in code. A `RoleAssignment` row (apps/roles/models.py) stores only who
holds which role on which scope; what that allows is read from here, and a view
checks a permission, never a role name (docs/decisions.md, 2026-09-25, *The data
model is decided on paper before roles are built on it*, point 2). The
administrator is Django's `is_superuser` and is not a role here.

A permission is `<scope>.<action>` and applies to one kind of scope, a
programme or an edition. A permission added for a new feature (`#97`, `#35`)
is also a question of who may grant it: whoever holds a role can make others
hold it.
"""

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType

from django.db import models
from django.utils.translation import gettext_lazy as _


class Role(models.TextChoices):
    TEACHER = "teacher", _("teacher")
    SECRETARIAT = "secretariat", _("secretariat staff")


class Permission(StrEnum):
    PROGRAMME_VIEW = "programme.view"
    PROGRAMME_ASSIGN_SECRETARIAT = "programme.assign_secretariat"
    EDITION_VIEW = "edition.view"
    EDITION_SET_CURRENT = "edition.set_current"
    EDITION_ASSIGN_TEACHER = "edition.assign_teacher"


PROGRAMME_PERMISSIONS = frozenset(p for p in Permission if p.startswith("programme."))
EDITION_PERMISSIONS = frozenset(p for p in Permission if p.startswith("edition."))

# No role holds PROGRAMME_ASSIGN_SECRETARIAT: only the superuser assigns secretariat staff.
ROLE_PERMISSIONS: Mapping[Role, frozenset[Permission]] = MappingProxyType(
    {
        Role.TEACHER: frozenset({Permission.EDITION_VIEW, Permission.EDITION_SET_CURRENT}),
        Role.SECRETARIAT: frozenset(
            {
                Permission.PROGRAMME_VIEW,
                Permission.EDITION_VIEW,
                Permission.EDITION_SET_CURRENT,
                Permission.EDITION_ASSIGN_TEACHER,
            }
        ),
    }
)


def roles_with(permission: Permission) -> frozenset[Role]:
    """The roles that hold `permission` on the scopes they cover."""
    return frozenset(role for role, held in ROLE_PERMISSIONS.items() if permission in held)
