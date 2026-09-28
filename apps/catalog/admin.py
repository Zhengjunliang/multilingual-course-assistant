"""Admin for the catalogue: degree programmes, courses, editions and curricula.

Entering PPM's rows (docs/decisions.md, 2026-09-25, *PPM read from Moodle and
Cineca*) and switching a course's current edition both go through here. The
admin never writes `is_current` itself: the flag is read-only on every form,
and the only way to flip it is the `set_as_current` action, which calls
`set_current()` (`apps/catalog/editions.py`) so the switch runs under the row
lock that keeps the one-current-edition-per-course constraint from being hit
mid-flight.

`Course.code` and `CourseEdition.academic_year` are read-only once a row is
saved: together they are the `(course.code, academic_year)` pair `rag/` and
the command line parse (`apps/catalog/models.py`), so a saved row's identity
must not move under material already indexed by it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.contrib import admin, messages
from django.utils.translation import gettext_lazy as _

from apps.catalog.editions import set_current
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme

if TYPE_CHECKING:
    from django.db.models import Model, QuerySet
    from django.http import HttpRequest


@admin.register(DegreeProgramme)
class DegreeProgrammeAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("code", "name", "locale")


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    def get_readonly_fields(
        self, request: HttpRequest, obj: Model | None = None
    ) -> tuple[str, ...]:
        return ("code",) if obj is not None else ()


@admin.register(CourseEdition)
class CourseEditionAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("__str__", "is_current")
    list_filter = ("is_current",)
    list_select_related = ("course",)
    actions = ("set_as_current",)

    def get_readonly_fields(
        self, request: HttpRequest, obj: Model | None = None
    ) -> tuple[str, ...]:
        # is_current is read-only on the add page too, so a new row cannot be
        # entered current. course and academic_year join it on the change page:
        # the pair is the search index's key (apps/catalog/models.py), fixed once saved.
        if obj is not None:
            return ("course", "academic_year", "is_current")
        return ("is_current",)

    # permissions: Django offers an action to every user who may see the
    # changelist unless it names the permission it needs.
    @admin.action(description=_("Set as current edition"), permissions=["change"])
    def set_as_current(self, request: HttpRequest, queryset: QuerySet[CourseEdition]) -> None:
        if queryset.count() != 1:
            self.message_user(
                request, _("Select exactly one edition to switch."), level=messages.ERROR
            )
            return
        edition = queryset.get()
        try:
            set_current(edition)
        except CourseEdition.DoesNotExist:
            self.message_user(request, _("This edition no longer exists."), level=messages.ERROR)
            return
        self.message_user(
            request, _("%(edition)s is now the current edition.") % {"edition": edition}
        )


@admin.register(CurriculumEntry)
class CurriculumEntryAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("programme", "course", "curriculum", "year_of_study", "ad_code")
    list_filter = ("programme", "curriculum")
    list_select_related = ("programme", "course")
