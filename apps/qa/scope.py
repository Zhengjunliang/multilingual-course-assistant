"""Which editions' slides a signed-in caller is answered from, and whose decks they open (#36).

Computed on the server from the account on every request, never taken from the
client, as two sets of `CourseEdition` rows:

- **The boundary**, what the caller may read at all: the started editions,
  current and past, of every course their declared programme lists
  (`StudentProgramme`, apps/accounts/models.py), and the editions a role lets
  them view (`editions_for`, apps/roles/scopes.py): every year of a teacher's
  course, every edition of a secretariat's programme, every edition for a
  superuser. A deck is served from inside it only (apps/qa/source_views.py),
  and a question naming an edition outside it is refused (apps/qa/views.py).
- **The default**, what a question searches unless its conversation added
  more: each course's current edition (apps/catalog/editions.py), and the
  editions a teacher's course has that are not past, so a teacher who has
  just uploaded next year's deck can try a question on it.

A conversation adds editions of the boundary to its default
(`Conversation.added_editions`): a student reads a past year that way, and a
member of staff an edition not started yet. An added edition the boundary no
longer holds, because a role or a programme changed, is no longer searched.

An account with neither a programme nor a role has an empty boundary, and its
questions are answered from the campus pages alone, as a visitor's are. The
declared programme is the student's own word: it keeps a search consistent
and protects nothing (docs/data-model.md, scope invariant 3). The year of
study orders the course list and decides nothing here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from apps.accounts.models import StudentProgramme
from apps.catalog.editions import IS_CURRENT, IS_PAST, with_current
from apps.catalog.models import CourseEdition, CurriculumEntry
from apps.roles.registry import Permission
from apps.roles.scopes import as_teacher, editions_for, with_edition_roles
from rag.chunk import EditionKey

if TYPE_CHECKING:
    from collections.abc import Collection, Iterable

    from django.db.models import QuerySet

    from apps.accounts.models import User


def boundary(user: User) -> QuerySet[CourseEdition]:
    """The editions `user` may read, with their course, each marked for `is_default`.

    One query whatever the account holds: the programme and the roles are
    subqueries of it.
    """
    declared = CurriculumEntry.objects.filter(
        course=OuterRef("course"),
        programme__in=StudentProgramme.objects.filter(user=user).values("programme"),
    )
    started = Q(**{IS_CURRENT: True}) | Q(**{IS_PAST: True})
    viewed = editions_for(user, Permission.EDITION_VIEW).values("pk")
    editions = with_current(
        with_edition_roles(CourseEdition.objects.select_related("course"), user),
        timezone.localdate(),
    )
    return editions.filter((Exists(declared) & started) | Q(pk__in=viewed))


def is_default(edition: CourseEdition) -> bool:
    """Whether a row of `boundary` is searched without being added."""
    return getattr(edition, IS_CURRENT) or (as_teacher(edition) and not getattr(edition, IS_PAST))


def search_scope(editions: Iterable[CourseEdition], added: Collection[int]) -> list[EditionKey]:
    """What a question searches: the default among `editions`, rows of `boundary`,
    and those of them `added` names by id.

    Empty when the caller reads no edition, which skips the slides collection
    without querying it (rag/search.py).
    """
    return [
        EditionKey(edition.course.code, edition.academic_year)
        for edition in editions
        if is_default(edition) or edition.pk in added
    ]
