"""Changing which edition of a course is current.

`set_current()` is the one way to do it (docs/data-model.md, invariant 2).
The constraint that lets a course have at most one current edition cannot be
deferred, so a switch has an order — clear the old flag, then set the new one
— and two switches of the same course must queue rather than interleave. The
function therefore takes the course's edition rows under a row lock before it
writes anything: a second switch waits for the first to commit, then works on
what the first left behind.

Who may switch an edition is not decided here. Roles belong to `#93`, and the
caller that knows the user checks them before calling.
"""

from __future__ import annotations

from django.db import transaction

from apps.catalog.models import CourseEdition


def set_current(edition: CourseEdition) -> None:
    """Make `edition` the current edition of its course, and no other one.

    Raises `CourseEdition.DoesNotExist`, changing nothing, when the row is gone
    by the time the lock is taken — deleted from a page opened earlier, or by a
    delete that committed while this switch waited. On return the instance
    passed in reads `is_current` the way the row does.
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
        stale = CourseEdition.objects.filter(course=course, is_current=True).exclude(pk=edition.pk)
        stale.update(is_current=False)
        CourseEdition.objects.filter(pk=edition.pk).update(is_current=True)
    edition.is_current = True
