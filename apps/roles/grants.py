"""Granting and revoking a staff role: the writes, and the log line each leaves.

Like `set_current()`, these do not decide who may call them: the views check
the assign table first (apps/catalog/staff_views.py). Each grant and each
revocation made here is logged once its transaction commits, so a write that
is rolled back leaves no line, the way Moodle's `role_assign()` fires its
`role_assigned` event; a grant the user already holds changes nothing and logs
nothing. The superuser's changes in the admin do not come through here and
stay in the admin's own history; neither do the demo seed's
(apps/roles/management/commands/populate_demo.py), which prints each role row
it adds or removes.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import psycopg
from django.db import IntegrityError, transaction

from apps.catalog.models import CourseEdition
from apps.roles.models import RoleAssignment

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import DegreeProgramme
    from apps.roles.registry import Role

logger = logging.getLogger(__name__)


class AlreadyHeldError(Exception):
    """The user already holds this role on this scope."""


def grant(
    actor: User, user: User, role: Role, scope: CourseEdition | DegreeProgramme
) -> RoleAssignment:
    """Give `user` the role on `scope`; raises `AlreadyHeldError` when they have it."""
    on = {"edition": scope} if isinstance(scope, CourseEdition) else {"programme": scope}
    try:
        # Its own savepoint, so a refused insert leaves the caller's
        # transaction usable.
        with transaction.atomic():
            assignment = RoleAssignment.objects.create(user=user, role=role, **on)
    except IntegrityError as exc:
        # Only the unique constraint means "already held"; the check
        # constraint failing would be a caller pairing a role with the wrong
        # kind of scope, a bug to surface rather than a 400.
        cause = exc.__cause__
        if (
            isinstance(cause, psycopg.Error)
            and cause.diag.constraint_name == "roles_assignment_unique"
        ):
            raise AlreadyHeldError from exc
        raise
    line = (role, assignment.scope_label, user.get_username(), actor.get_username())
    transaction.on_commit(lambda: logger.info("granted %s on %s to %s by %s", *line))
    return assignment


def revoke(actor: User, assignment: RoleAssignment) -> bool:
    """Take the role of `assignment` away from its user; False when the row was gone already.

    Deleted by primary key and logged only when a row went, so two requests
    revoking one role at once remove it once and log it once: the second
    waits on the first's row lock and then finds nothing to delete.
    """
    line = (
        assignment.role,
        assignment.scope_label,
        assignment.user.get_username(),
        actor.get_username(),
    )
    deleted, _ = RoleAssignment.objects.filter(pk=assignment.pk).delete()
    if not deleted:
        return False
    transaction.on_commit(lambda: logger.info("revoked %s on %s from %s by %s", *line))
    return True
