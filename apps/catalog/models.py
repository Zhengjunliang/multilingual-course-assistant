"""The university's catalogue: degree programmes, courses and their yearly editions.

Two levels, the way UniFi lists them. A `DegreeProgramme` (`B047`) offers a
`Course` (`B028451`) through a `CurriculumEntry`, which says in which curriculum
and year of study; a course shared between curricula or programmes is one more
entry pointing at the same course, never a copy of it. A `CourseEdition` is one
academic year of a course, and it is the row the rest of the site will hang on:
material, syllabus, reading list, teachers.

`(course.code, academic_year)` is also the pair every slides chunk carries in
`rag/`. It crosses that boundary as two plain strings — `rag/` never imports
Django — so the strings themselves are the contract, which is why neither may
change once the edition exists.

Nothing here points at the user model. Roles, uploaded material and a student's
programme will point at these tables; an arrow the other way would make the
catalogue depend on who is reading it. The schema, its invariants and the
contract with `rag/` are owned by docs/data-model.md; the reasons for each
choice by docs/decisioni.md, the two entries of 2026-09-25.
"""

from __future__ import annotations

import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

_ACADEMIC_YEAR = re.compile(r"(\d{4})-(\d{4})", re.ASCII)

# One message for both halves of the rule, so a person entering a year reads the
# same sentence whichever half rejected it.
_ACADEMIC_YEAR_MESSAGE = _("An academic year is two consecutive years, such as 2025-2026.")


def validate_academic_year(value: str) -> None:
    """Reject a year that is not two consecutive years, such as `2025-2027`.

    The database checks the shape (the check constraint on `CourseEdition`);
    this adds that the second year follows the first, and it runs where a person
    types the value — the admin form and `full_clean`. The same test in SQL would
    need a cast that fails on a malformed value before the shape check could
    reject it, turning a clear refusal into a data error.
    """
    match = _ACADEMIC_YEAR.fullmatch(value)
    if match is None or int(match[2]) != int(match[1]) + 1:
        raise ValidationError(_ACADEMIC_YEAR_MESSAGE, code="academic_year")


class DegreeProgramme(models.Model):
    """A degree programme (*corso di laurea*), coded as the Cineca catalogue codes it.

    The programme's level, credits and cohorts are not stored: no code reads
    them yet, and each is an added column the day one does.
    """

    code = models.CharField(
        max_length=16,
        unique=True,
        verbose_name=_("code"),
        help_text=_("The code the Cineca catalogue prints in brackets, such as B047."),
    )
    name = models.CharField(max_length=200, verbose_name=_("name"))
    locale = models.CharField(
        max_length=16,
        choices=settings.LANGUAGES,
        default=settings.LANGUAGE_CODE,
        verbose_name=_("language"),
        help_text=_("Language the name is written in."),
    )

    class Meta:
        ordering = ("code",)
        verbose_name = _("degree programme")
        verbose_name_plural = _("degree programmes")

    def __str__(self) -> str:
        return f"[{self.code}] {self.name}"


class Course(models.Model):
    """A course, independent of the year it is taught in.

    A course can have more than one official code, one per curriculum that
    offers it. `code` is the one whose Moodle course holds the material — the
    teacher's choice, read from Moodle — and every other code lives on a
    `CurriculumEntry`.
    """

    code = models.CharField(
        max_length=16,
        unique=True,
        verbose_name=_("code"),
        help_text=_(
            "AD code of the Moodle course that holds the material, such as B028451. "
            "Fixed once entered."
        ),
    )
    name = models.CharField(max_length=200, verbose_name=_("name"))
    locale = models.CharField(
        max_length=16,
        choices=settings.LANGUAGES,
        default=settings.LANGUAGE_CODE,
        verbose_name=_("language"),
        help_text=_("Language the name is written in."),
    )

    class Meta:
        ordering = ("code",)
        verbose_name = _("course")
        verbose_name_plural = _("courses")

    def __str__(self) -> str:
        return f"[{self.code}] {self.name}"


class CourseEdition(models.Model):
    """One academic year of a course.

    At most one edition per course is current, and that is a database
    constraint, not a convention: a search defaults to the current edition, so
    two current ones would make the default depend on which row the planner
    returned first. The constraint cannot be deferred, which fixes the order of a
    switch — clear the old flag, then set the new one, inside one transaction
    (docs/data-model.md, invariant 2).
    """

    # PROTECT, not CASCADE: an edition will own material whose points live in
    # Qdrant, and a cascading delete in PostgreSQL cannot reach them.
    course = models.ForeignKey(
        Course,
        on_delete=models.PROTECT,
        related_name="editions",
        verbose_name=_("course"),
    )
    academic_year = models.CharField(
        max_length=9,
        validators=(validate_academic_year,),
        verbose_name=_("academic year"),
        help_text=_("Two consecutive years, such as 2025-2026."),
    )
    is_current = models.BooleanField(default=False, verbose_name=_("current"))

    class Meta:
        ordering = ("course", "-academic_year")
        verbose_name = _("course edition")
        verbose_name_plural = _("course editions")
        constraints = (
            models.UniqueConstraint(
                fields=("course", "academic_year"),
                name="catalog_edition_unique_course_year",
            ),
            models.CheckConstraint(
                condition=models.Q(academic_year__regex=r"^\d{4}-\d{4}$"),
                name="catalog_edition_academic_year_format",
                violation_error_message=_ACADEMIC_YEAR_MESSAGE,
            ),
            models.UniqueConstraint(
                fields=("course",),
                condition=models.Q(is_current=True),
                name="catalog_edition_one_current_per_course",
            ),
        )

    def __str__(self) -> str:
        # Reads the course row: an edition is not recognisable by its year alone.
        # CODE:YEAR is how a scope is spelt on the command line (docs/data-model.md).
        return f"{self.course.code}:{self.academic_year}"


class CurriculumEntry(models.Model):
    """A programme offers a course in one curriculum, in one year of study.

    A course appears once per curriculum. When the Cineca study plan lists two
    official codes for it in the same curriculum, `ad_code` is the one listed
    only there; that rule, and the one course it has been checked on, are in
    docs/decisioni.md, 2026-09-25.
    """

    programme = models.ForeignKey(
        DegreeProgramme,
        on_delete=models.CASCADE,
        related_name="curriculum_entries",
        verbose_name=_("degree programme"),
    )
    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name="curriculum_entries",
        verbose_name=_("course"),
    )
    # Empty, never NULL, when the programme has no curricula: NULLs are distinct
    # in a unique constraint, so two NULL rows would slip past both below.
    curriculum = models.CharField(
        max_length=100,
        blank=True,
        default="",
        verbose_name=_("curriculum"),
        help_text=_(
            "The curriculum name exactly as the Cineca catalogue prints it, such as "
            "TECNICO APPLICATIVO; empty when it prints none."
        ),
    )
    # Six is the longest programme there is, a single-cycle master's degree.
    year_of_study = models.PositiveSmallIntegerField(
        validators=(MinValueValidator(1), MaxValueValidator(6)),
        verbose_name=_("year of study"),
    )
    ad_code = models.CharField(
        max_length=16,
        verbose_name=_("AD code"),
        help_text=_(
            "The official code of the course in this curriculum. When the curriculum "
            "lists two for one course, the one listed only in this curriculum."
        ),
    )

    class Meta:
        ordering = ("programme", "curriculum", "year_of_study", "ad_code")
        verbose_name = _("curriculum entry")
        verbose_name_plural = _("curriculum entries")
        constraints = (
            models.UniqueConstraint(
                fields=("programme", "curriculum", "ad_code"),
                name="catalog_entry_unique_ad_code",
            ),
            models.UniqueConstraint(
                fields=("programme", "curriculum", "course"),
                name="catalog_entry_unique_course",
            ),
        )

    def __str__(self) -> str:
        # The prefix Moodle puts on a course title, "<AD code> (<programme>)".
        return f"{self.ad_code} ({self.programme.code}) {self.curriculum}".rstrip()
