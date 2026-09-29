"""Who covers which scope, written once.

A teacher covers the edition their row names. Secretariat staff cover their
programme and every edition of every course the programme offers, a course
shared with another programme included. That rule is the two role-to-annotation
maps and the `Exists` subqueries below, and nothing else restates it: the
backend behind `user.has_perm` (apps/roles/backends.py), the catalogue lists
and each item's `permissions` all read it, so the three cannot disagree.

Each role is a boolean annotation on the scope rows. `Exists` rather than a
join through the role rows: a user covering an edition twice — its teacher and
its programme's secretariat — still yields one row, with no `distinct()`, and
a list stays one query however many rows it holds.

A caller with no account, or a disabled one, covers nothing. An active
superuser covers everything and holds every permission of each scope, as
Django's own `has_perm` answers for them before asking any backend.
"""

from __future__ import annotations

from functools import reduce
from operator import or_
from types import MappingProxyType
from typing import TYPE_CHECKING, cast

from django.contrib.auth.models import AnonymousUser
from django.db.models import Exists, OuterRef, Q, QuerySet

from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.roles.models import RoleAssignment
from apps.roles.registry import (
    EDITION_PERMISSIONS,
    PROGRAMME_PERMISSIONS,
    ROLE_PERMISSIONS,
    Permission,
    Role,
    roles_with,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

    from django.contrib.auth.base_user import AbstractBaseUser

    from apps.accounts.models import User

    type Caller = AbstractBaseUser | AnonymousUser

# The role -> annotation maps: which flag on a scope row says the user covers it in that role.
_EDITION_FLAGS: Mapping[Role, str] = MappingProxyType(
    {Role.TEACHER: "as_teacher", Role.SECRETARIAT: "as_secretariat"}
)
_PROGRAMME_FLAGS: Mapping[Role, str] = MappingProxyType({Role.SECRETARIAT: "as_secretariat"})


def _active(user: Caller) -> User | None:
    """The caller as this project's user, or None when they hold nothing.

    The cast is the one apps/accounts/views.py explains for `session_body`:
    pyright has no plugin to resolve `AUTH_USER_MODEL`.
    """
    if isinstance(user, AnonymousUser) or not user.is_active:
        return None
    return cast("User", user)


def with_edition_roles(editions: QuerySet[CourseEdition], user: User) -> QuerySet[CourseEdition]:
    """`editions`, each marked with the roles in which `user` covers it."""
    rows = RoleAssignment.objects.filter(user=user)
    return editions.annotate(
        **{
            _EDITION_FLAGS[Role.TEACHER]: Exists(
                rows.filter(role=Role.TEACHER, edition=OuterRef("pk"))
            ),
            _EDITION_FLAGS[Role.SECRETARIAT]: Exists(
                rows.filter(
                    role=Role.SECRETARIAT,
                    programme__curriculum_entries__course=OuterRef("course"),
                )
            ),
        }
    )


def with_programme_roles(
    programmes: QuerySet[DegreeProgramme], user: User
) -> QuerySet[DegreeProgramme]:
    """`programmes`, each marked with the roles in which `user` covers it."""
    rows = RoleAssignment.objects.filter(user=user)
    return programmes.annotate(
        **{
            _PROGRAMME_FLAGS[Role.SECRETARIAT]: Exists(
                rows.filter(role=Role.SECRETARIAT, programme=OuterRef("pk"))
            ),
        }
    )


def _covering(flags: Mapping[Role, str], permission: Permission) -> Q | None:
    """The filter keeping the rows on which some role holding `permission` covers them.

    None when no role that marks this kind of scope holds it: an OR over no
    terms would be the empty `Q()`, which keeps every row.
    """
    terms = [Q(**{flag: True}) for role, flag in flags.items() if role in roles_with(permission)]
    return reduce(or_, terms) if terms else None


def editions_for(user: Caller, permission: Permission) -> QuerySet[CourseEdition]:
    """The editions on which `user` holds `permission`, marked for `permissions_on`."""
    caller = _active(user)
    if caller is None or permission not in EDITION_PERMISSIONS:
        return CourseEdition.objects.none()
    editions = with_edition_roles(CourseEdition.objects.all(), caller)
    if caller.is_superuser:
        return editions
    covering = _covering(_EDITION_FLAGS, permission)
    return editions.filter(covering) if covering is not None else editions.none()


def programmes_for(user: Caller, permission: Permission) -> QuerySet[DegreeProgramme]:
    """The programmes on which `user` holds `permission`, marked for `permissions_on`."""
    caller = _active(user)
    if caller is None or permission not in PROGRAMME_PERMISSIONS:
        return DegreeProgramme.objects.none()
    programmes = with_programme_roles(DegreeProgramme.objects.all(), caller)
    if caller.is_superuser:
        return programmes
    covering = _covering(_PROGRAMME_FLAGS, permission)
    return programmes.filter(covering) if covering is not None else programmes.none()


def permissions_on(user: Caller, scope: CourseEdition | DegreeProgramme) -> frozenset[Permission]:
    """What `user` holds on `scope`, a row read through `with_*_roles` for this same user.

    The flags are read before anything else, so a row that was not marked
    raises `AttributeError` instead of passing for a scope the user holds
    nothing on.
    """
    if isinstance(scope, CourseEdition):
        flags, scoped = _EDITION_FLAGS, EDITION_PERMISSIONS
    else:
        flags, scoped = _PROGRAMME_FLAGS, PROGRAMME_PERMISSIONS
    covering = [role for role, flag in flags.items() if getattr(scope, flag)]
    caller = _active(user)
    if caller is None:
        return frozenset()
    if caller.is_superuser:
        return scoped
    held: frozenset[Permission] = frozenset().union(*(ROLE_PERMISSIONS[r] for r in covering))
    return held & scoped


def held_on(user: Caller, scope: CourseEdition | DegreeProgramme) -> frozenset[Permission]:
    """What `user` holds on `scope`, reading its row again in one query.

    Read again rather than trusting marks already on `scope`: those may have
    been computed for another user, or before a role changed. A scope that no
    longer exists grants nothing.
    """
    caller = _active(user)
    if caller is None:
        return frozenset()
    if isinstance(scope, CourseEdition):
        row = with_edition_roles(CourseEdition.objects.filter(pk=scope.pk), caller).first()
    else:
        row = with_programme_roles(DegreeProgramme.objects.filter(pk=scope.pk), caller).first()
    return frozenset() if row is None else permissions_on(caller, row)


def role_scopes(user: User) -> list[dict[str, object]]:
    """Where `user` holds a role, one entry per row, in one query.

    Each scope is named by the key a URL would name it with: an edition by its
    id, a programme by its code. What the role allows there is not part of the
    entry; it is answered per scope, and the SPA never derives a permission
    from a role name.
    """
    rows = (
        RoleAssignment.objects.filter(user=user)
        .order_by("role", "edition", "programme__code")
        .values_list("role", "edition", "programme__code")
    )
    return [
        {"role": role, "edition": edition}
        if role == Role.TEACHER
        else {"role": role, "programme": programme}
        for role, edition, programme in rows
    ]
