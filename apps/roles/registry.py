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
programme or an edition. A permission added to a role for a new feature
(`#97`, `#35`) is also a question of who may grant it: whoever may grant the
role (`GRANT_PERMISSION` below) hands out every permission the role carries.
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
    EDITION_ASSIGN_TEACHER = "edition.assign_teacher"
    EDITION_EDIT_CONTENT = "edition.edit_content"
    EDITION_MANAGE_MATERIALS = "edition.manage_materials"


PROGRAMME_PERMISSIONS = frozenset(p for p in Permission if p.startswith("programme."))
EDITION_PERMISSIONS = frozenset(p for p in Permission if p.startswith("edition."))

# No role holds PROGRAMME_ASSIGN_SECRETARIAT: only the superuser assigns secretariat staff.
# An edition's content — its syllabus and reading list, and the material it is searched
# for — is edited by its teacher or the secretariat (docs/decisions.md, 2026-09-25, *The
# data model is decided on paper before roles are built on it*, point 4); the material
# has a permission of its own because it is uploaded and ingested rather than typed. A
# course's teachers assign their colleagues, on the editions `NOT_ON_PAST_EDITIONS` leaves them.
ROLE_PERMISSIONS: Mapping[Role, frozenset[Permission]] = MappingProxyType(
    {
        Role.TEACHER: frozenset(
            {
                Permission.EDITION_VIEW,
                Permission.EDITION_ASSIGN_TEACHER,
                Permission.EDITION_EDIT_CONTENT,
                Permission.EDITION_MANAGE_MATERIALS,
            }
        ),
        Role.SECRETARIAT: frozenset(
            {
                Permission.PROGRAMME_VIEW,
                Permission.EDITION_VIEW,
                Permission.EDITION_ASSIGN_TEACHER,
                Permission.EDITION_EDIT_CONTENT,
                Permission.EDITION_MANAGE_MATERIALS,
            }
        ),
    }
)


# What a role does not hold on a past edition, one older than its course's current
# edition (apps/catalog/editions.py): a past edition's teacher rows record who taught
# that year, and are not its course's teachers to change; secretariat staff still change
# them (docs/decisions.md, 2026-10-27, *A course's teachers staff its current and later
# editions, and leave each of them a teacher*, point 1).
NOT_ON_PAST_EDITIONS: Mapping[Role, frozenset[Permission]] = MappingProxyType(
    {Role.TEACHER: frozenset({Permission.EDITION_ASSIGN_TEACHER})}
)


def roles_with(permission: Permission) -> frozenset[Role]:
    """The roles that hold `permission` on the scopes they cover, or on some of them."""
    return frozenset(role for role, held in ROLE_PERMISSIONS.items() if permission in held)


# The assign table: holding this permission on a role's scope is what lets a
# caller grant or revoke that role there, as Moodle's role_allow_assign and
# Open edX's _check_caller_authority decide it. Secretariat staff assign
# teachers in their programme's editions, and a course's teachers their
# colleagues; no role holds the permission that assigns secretariat staff, so
# only the superuser does.
GRANT_PERMISSION: Mapping[Role, Permission] = MappingProxyType(
    {
        Role.TEACHER: Permission.EDITION_ASSIGN_TEACHER,
        Role.SECRETARIAT: Permission.PROGRAMME_ASSIGN_SECRETARIAT,
    }
)
