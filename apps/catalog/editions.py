"""Which edition of a course is current: the newest one whose teaching has started.

Derived, never stored (docs/decisions.md, 2026-09-25, *The data model is
decided on paper before roles are built on it*, point 1). An edition records
the day its teaching starts, `teaching_starts`, and the current edition of a
course is the one of the latest academic year among those started by `today`,
so nobody switches anything and the default moves on by itself. An edition
with no start day entered counts from 1 September of its first year. A course
whose editions have none of them started has no current edition.

`with_current()` is the one definition: an annotation on the edition rows,
which the edition list, an edition's page and a programme's study plan read in
the one query each already runs. It compares an edition with every edition of
its course, not only those the caller may see, so the answer is the same
whoever asks. `today` is the caller's to give: the catalogue views pass
`timezone.localdate()`, and a test the day it needs.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import BooleanField, DateField, Exists, ExpressionWrapper, OuterRef, Value
from django.db.models.functions import Cast, Coalesce, Concat, Left
from django.db.models.lookups import LessThanOrEqual

from apps.catalog.models import CourseEdition

if TYPE_CHECKING:
    from datetime import date

    from django.db.models import QuerySet

# The mark `with_current()` puts on an edition row.
IS_CURRENT = "is_current"


def _started(today: date) -> LessThanOrEqual:
    """True for an edition whose teaching has started by `today`.

    Its start is `teaching_starts`, or 1 September of the academic year's
    first year: the year's leading four digits, which the check constraint on
    `CourseEdition` guarantees, as a date.
    """
    fallback = Cast(Concat(Left("academic_year", 4), Value("-09-01")), DateField())
    return LessThanOrEqual(Coalesce("teaching_starts", fallback), Value(today))


def with_current[E: CourseEdition](editions: QuerySet[E], today: date) -> QuerySet[E]:
    """`editions`, each marked with whether it is its course's current edition on `today`.

    Current: started, and no edition of the same course in a later academic
    year has started. The years of a course are unique, so two editions are
    never current together.
    """
    later = CourseEdition.objects.filter(
        _started(today), course=OuterRef("course"), academic_year__gt=OuterRef("academic_year")
    )
    return editions.annotate(
        **{
            IS_CURRENT: ExpressionWrapper(
                _started(today) & ~Exists(later), output_field=BooleanField()
            )
        }
    )
