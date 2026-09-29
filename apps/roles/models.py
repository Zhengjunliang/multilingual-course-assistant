"""Staff roles as rows: who holds which role on which scope.

A row states one fact — a user teaches one course edition, or is secretariat
staff of one degree programme — and nothing about what that allows: the roles
are code, in apps/roles/registry.py. That a role and its scope fit, and that a
fact is stored once, are database constraints (docs/data-model.md, invariant 3).

Every foreign key cascades. A row grants, it owns nothing: when the person, the
edition or the programme goes, the grant goes with it, the way Moodle deletes a
context's role assignments with the context. No `locale`: a relation carries no
user-visible text of its own.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.roles.registry import Role


class RoleAssignment(models.Model):
    """One staff role on one scope: a teacher on an edition, secretariat staff on a programme."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="role_assignments",
        verbose_name=_("user"),
    )
    role = models.CharField(max_length=16, choices=Role.choices, verbose_name=_("role"))
    programme = models.ForeignKey(
        DegreeProgramme,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="role_assignments",
        verbose_name=_("degree programme"),
        help_text=_("Secretariat staff only."),
    )
    edition = models.ForeignKey(
        CourseEdition,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="role_assignments",
        verbose_name=_("course edition"),
        help_text=_("Teachers only."),
    )

    class Meta:
        ordering = ("user", "role")
        verbose_name = _("role assignment")
        verbose_name_plural = _("role assignments")
        constraints = (
            models.CheckConstraint(
                condition=models.Q(role=Role.TEACHER, edition__isnull=False, programme__isnull=True)
                | models.Q(role=Role.SECRETARIAT, programme__isnull=False, edition__isnull=True),
                name="roles_assignment_scope_fits_role",
                violation_error_message=_(
                    "A teacher is assigned to an edition, secretariat staff to a programme."
                ),
            ),
            # NULLs not distinct: every row has one scope column empty, and with
            # distinct NULLs the same grant could be stored twice.
            models.UniqueConstraint(
                fields=("user", "role", "programme", "edition"),
                nulls_distinct=False,
                name="roles_assignment_unique",
                violation_error_message=_("This user already holds this role here."),
            ),
        )

    def __str__(self) -> str:
        # getattr, not self.user: an unsaved row with no user raises
        # RelatedObjectDoesNotExist, a subclass of AttributeError getattr catches.
        # A scope is spelt the way the command line spells it: CODE:YEAR for an
        # edition, the code for a programme.
        user = getattr(self, "user", None)
        scope = self.edition or (self.programme.code if self.programme else "?")
        return f"{user.get_username() if user else '?'} · {self.role} · {scope}"
