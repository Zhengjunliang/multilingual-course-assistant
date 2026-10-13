"""Admin for the catalogue: degree programmes, courses, editions and curricula.

The superuser's, as the whole admin is (config/admin.py): entering PPM's rows
(docs/decisions.md, 2026-09-25, *PPM read from Moodle and Cineca*) goes
through here. Which edition is current is nobody's to set: it follows each
edition's `teaching_starts` (apps/catalog/editions.py), the one field here
that decides it.

An edition's syllabus and reading list are edited inside the edition, the
rows they belong to.

`Course.code` and `CourseEdition.academic_year` are read-only once a row is
saved: together they are the `(course.code, academic_year)` pair `rag/` and
the command line parse (`apps/catalog/models.py`), so a saved row's identity
must not move under material already indexed by it.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING

from django.contrib import admin
from django.db import models

from apps.catalog.models import (
    Course,
    CourseEdition,
    CurriculumEntry,
    DegreeProgramme,
    ReadingItem,
    Syllabus,
)

if TYPE_CHECKING:
    from django.db.models import Model
    from django.http import HttpRequest


@admin.register(DegreeProgramme)
class DegreeProgrammeAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("code", "name", "locale")


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("code", "name", "code_source")

    def get_readonly_fields(
        self, request: HttpRequest, obj: Model | None = None
    ) -> tuple[str, ...]:
        return ("code",) if obj is not None else ()


class SyllabusInline(admin.StackedInline):  # pyright: ignore[reportMissingTypeArgument]
    model = Syllabus
    extra = 0


class ReadingItemInline(admin.TabularInline):  # pyright: ignore[reportMissingTypeArgument]
    model = ReadingItem
    extra = 0
    # A link typed without a scheme is taken as https, the default Django 6.0 adopts.
    formfield_overrides = MappingProxyType({models.URLField: {"assume_scheme": "https"}})


@admin.register(CourseEdition)
class CourseEditionAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("__str__", "teaching_starts")
    list_select_related = ("course",)
    inlines = (SyllabusInline, ReadingItemInline)

    def get_readonly_fields(
        self, request: HttpRequest, obj: Model | None = None
    ) -> tuple[str, ...]:
        # The pair is the search index's key (apps/catalog/models.py), fixed once saved.
        return ("course", "academic_year") if obj is not None else ()


@admin.register(CurriculumEntry)
class CurriculumEntryAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("programme", "course", "curriculum", "year_of_study", "ad_code")
    list_filter = ("programme", "curriculum")
    list_select_related = ("programme", "course")
