"""Who covers which scope, written once.

A teacher covers every edition of the course their row names an edition of:
the years before it and after it, whoever taught them, as the supervisor asked
(docs/architecture.md). The row names one edition, so who taught which
year stays recorded. Secretariat staff cover their programme and every edition
of every course the programme offers, a course shared with another programme
included. That rule is the two role-to-annotation
maps and the `Exists` subqueries below, and nothing else restates it: the
backend behind `user.has_perm` (apps/roles/backends.py), the catalogue lists
and each item's `permissions` all read it, so the three cannot disagree.

Covering an edition is not holding everything on it: on a past edition, one
older than its course's current one (apps/catalog/editions.py), a role holds
what `NOT_ON_PAST_EDITIONS` (apps/roles/registry.py) leaves it, so a course's
teachers read and edit a past year but no longer change who taught it.
`_held_by` alone applies that, for the lists' filter and for one row's
permissions alike.

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
from django.utils import timezone

from apps.catalog.editions import IS_PAST, with_past
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.roles.models import RoleAssignment
from apps.roles.registry import (
    EDITION_PERMISSIONS,
    NOT_ON_PAST_EDITIONS,
    PROGRAMME_PERMISSIONS,
    ROLE_PERMISSIONS,
    Permission,
    Role,
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
    """`editions`, each marked with the roles in which `user` covers it, and whether it is past.

    Past on the day of the request, the day the catalogue views mark the
    current edition on (apps/catalog/views.py).
    """
    rows = RoleAssignment.objects.filter(user=user)
    return with_past(editions, timezone.localdate()).annotate(
        **{
            _EDITION_FLAGS[Role.TEACHER]: Exists(
                rows.filter(role=Role.TEACHER, edition__course=OuterRef("course"))
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


def _held_by(role: Role, *, past: bool) -> frozenset[Permission]:
    """What `role` holds on a scope it covers, a past edition or any other."""
    held = ROLE_PERMISSIONS[role]
    return held - NOT_ON_PAST_EDITIONS.get(role, frozenset()) if past else held


def _covering(flags: Mapping[Role, str], permission: Permission) -> Q | None:
    """The filter keeping the rows on which some role holding `permission` covers them.

    A role holding it on a past edition too keeps every row it covers; one
    holding it elsewhere only keeps the rows not past. None when no role that
    marks this kind of scope holds it: an OR over no terms would be the empty
    `Q()`, which keeps every row.
    """
    terms: list[Q] = []
    for role, flag in flags.items():
        if permission in _held_by(role, past=True):
            terms.append(Q(**{flag: True}))
        elif permission in _held_by(role, past=False):
            terms.append(Q(**{flag: True, IS_PAST: False}))
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


def courses_for(user: Caller, permission: Permission) -> QuerySet[Course]:
    """The courses listed by a programme on which `user` holds `permission`.

    A course is no scope of the registry: it is seen through the study plans
    that list it, a course with no edition yet included. So a teacher, who
    views no programme, reads no course, and reaches their editions through
    the edition list instead. Which programmes list a course is the public
    catalogue, so a course read this way shows all of them; whoever runs them
    stays behind each programme's own scope.
    """
    caller = _active(user)
    if caller is None or permission not in PROGRAMME_PERMISSIONS:
        return Course.objects.none()
    if caller.is_superuser:
        return Course.objects.all()
    listed = CurriculumEntry.objects.filter(
        course=OuterRef("pk"), programme__in=programmes_for(caller, permission)
    )
    return Course.objects.filter(Exists(listed))


def permissions_on(user: Caller, scope: CourseEdition | DegreeProgramme) -> frozenset[Permission]:
    """What `user` holds on `scope`, a row read through `with_*_roles` for this same user.

    The marks are read before anything else, so a row that was not marked
    raises `AttributeError` instead of passing for a scope the user holds
    nothing on. Each covering role adds what it holds there on its own, so
    what one role does not hold on a past edition takes nothing from another.
    """
    if isinstance(scope, CourseEdition):
        flags, scoped, past = _EDITION_FLAGS, EDITION_PERMISSIONS, getattr(scope, IS_PAST)
    else:
        flags, scoped, past = _PROGRAMME_FLAGS, PROGRAMME_PERMISSIONS, False
    covering = [role for role, flag in flags.items() if getattr(scope, flag)]
    caller = _active(user)
    if caller is None:
        return frozenset()
    if caller.is_superuser:
        return scoped
    held: frozenset[Permission] = frozenset().union(*(_held_by(r, past=past) for r in covering))
    return held & scoped


def must_leave_a_teacher(user: Caller, edition: CourseEdition) -> bool:
    """Whether `user`, removing a teacher row of `edition`, must leave it another.

    A teacher must; secretariat staff, who assign the teachers of their
    programme's editions, and the superuser need not
    (docs/decisions.md, 2026-10-27, *A course's teachers staff its current and
    later editions, and leave each of them a teacher*, point 2). Read from the
    marks `with_edition_roles` put on `edition` for this same user, as
    `permissions_on` reads them.
    """
    as_secretariat = getattr(edition, _EDITION_FLAGS[Role.SECRETARIAT])
    caller = _active(user)
    return caller is None or not (caller.is_superuser or as_secretariat)


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


# The order a user's roles are listed in, wherever they are listed.
ROLE_ORDER = ("role", "edition", "programme__code")


def role_scope(role: str, edition: int | None, programme: str | None) -> dict[str, object]:
    """One role row as the API names it.

    The scope is named by the key a URL would name it with: an edition by its
    id, a programme by its code. What the role allows there is not part of the
    entry; it is answered per scope, and the SPA never derives a permission
    from a role name.
    """
    if role == Role.TEACHER:
        return {"role": role, "edition": edition}
    return {"role": role, "programme": programme}


def role_scopes(user: User) -> list[dict[str, object]]:
    """Where `user` holds a role, one entry per row, in one query."""
    rows = (
        RoleAssignment.objects.filter(user=user)
        .order_by(*ROLE_ORDER)
        .values_list("role", "edition", "programme__code")
    )
    return [role_scope(role, edition, programme) for role, edition, programme in rows]
