"""Changing which edition of a course is current.

`set_current()` is the one way to do it (docs/data-model.md, invariant 2).
The constraint that lets a course have at most one current edition cannot be
deferred, so a switch has an order — clear the old flag, then set the new one
— and two switches of the same course must queue rather than interleave. The
function therefore takes the course's edition rows under a row lock before it
writes anything: a second switch waits for the first to commit, then works on
what the first left behind.

Who may switch an edition is the caller's to decide, since only the caller
knows the user. A switch changes two rows, the edition made current and the one
it replaces, so a caller can have the second checked too: `may_replace` is
asked about the replaced edition inside the lock, so the row it approves is
the row that gets cleared. The catalogue API checks both ends
(apps/catalog/views.py); the admin, which admits the superuser alone, passes
nothing, and so does the demo seed, which makes an edition current only for a
course with none, where nothing is replaced
(apps/roles/management/commands/populate_demo.py).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q

from apps.catalog.models import CourseEdition

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.db.models import OuterRef

    from apps.catalog.models import Course

# One fixed sentence, which tells the caller why without saying which edition
# is current; the catalogue API sends it with its code (apps/catalog/errors.py).
SWITCH_NEEDS_BOTH = "Switching also needs edition.set_current on the course's current edition."


def current_besides(course: Course | OuterRef, pk: int | OuterRef) -> Q:
    """The edition a switch to edition `pk` of `course` replaces: the course's other current one.

    The one definition of it. `set_current()` clears what it matches, and
    the catalogue lists ask it of each row through `OuterRef`s to tell the
    caller whether a switch would pass (`with_switch()`, apps/roles/scopes.py),
    so the flag a page reads and the check a switch makes cannot disagree.
    """
    return Q(course=course, is_current=True) & ~Q(pk=pk)


def _anyone(replaced: CourseEdition) -> bool:
    return True


def set_current(
    edition: CourseEdition, *, may_replace: Callable[[CourseEdition], bool] = _anyone
) -> None:
    """Make `edition` the current edition of its course, and no other one.

    Raises `CourseEdition.DoesNotExist`, changing nothing, when the row is gone
    by the time the lock is taken — deleted from a page opened earlier, or by a
    delete that committed while this switch waited. Raises `PermissionDenied`
    with `SWITCH_NEEDS_BOTH`, changing nothing, when the course has another
    current edition and `may_replace` refuses it; with no other current
    edition `may_replace` is not asked. On return the instance passed in reads
    `is_current` the way the row does.
    """
    course = edition.course
    with transaction.atomic():
        # pk order, not Meta.ordering ("course", ...): ordering by the foreign key
        # would JOIN catalog_course, and FOR UPDATE would lock the course row too.
        # One fixed order also makes two switches of a course queue on the same
        # first row instead of deadlocking on rows each has locked for the other.
        locked = list(
            CourseEdition.objects.select_for_update()
            .filter(course=course)
            .order_by("pk")
            .values_list("pk", flat=True)
        )
        if edition.pk not in locked:
            raise CourseEdition.DoesNotExist(
                f"edition {edition.pk} of {course.code} no longer exists"
            )
        # Clear first: the one-current constraint is not deferrable, so setting
        # the new flag while the old one stands would violate it on the spot.
        stale = CourseEdition.objects.filter(current_besides(course, edition.pk))
        # At most one, by the one-current constraint; order_by() drops the
        # Meta ordering's join, as above.
        replaced = stale.order_by().first()
        if replaced is not None and not may_replace(replaced):
            raise PermissionDenied(SWITCH_NEEDS_BOTH)
        stale.update(is_current=False)
        CourseEdition.objects.filter(pk=edition.pk).update(is_current=True)
    edition.is_current = True
