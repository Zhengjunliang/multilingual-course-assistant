"""Staff roles as rows: who holds which role on which scope, and who is invited to one.

A row states one fact — a user teaches one course edition, or is secretariat
staff of one degree programme — and nothing about what that allows: the roles
are code, in apps/roles/registry.py. That a role and its scope fit, and that a
fact is stored once, are database constraints (docs/data-model.md, invariant 3).
An invitation names a role and a scope the same way, for whoever accepts it
(apps/roles/invitations.py).

Every foreign key cascades. A row grants, it owns nothing: when the person, the
edition or the programme goes, the grant goes with it, the way Moodle deletes a
context's role assignments with the context. No `locale`: a relation carries no
user-visible text of its own.
"""

from __future__ import annotations

from typing import cast

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.roles.registry import Role


def on_scope(scope: CourseEdition | DegreeProgramme) -> dict[str, CourseEdition | DegreeProgramme]:
    """The column a row names `scope` in, as the keyword a query or a new row takes."""
    return {"edition": scope} if isinstance(scope, CourseEdition) else {"programme": scope}


def _fits_its_scope() -> models.Q:
    """A teacher's row names an edition, a secretariat row a programme, and neither both."""
    return models.Q(role=Role.TEACHER, edition__isnull=False, programme__isnull=True) | models.Q(
        role=Role.SECRETARIAT, programme__isnull=False, edition__isnull=True
    )


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
                condition=_fits_its_scope(),
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
        user = getattr(self, "user", None)
        return f"{user.get_username() if user else '?'} · {self.role} · {self.scope_label}"

    @property
    def scope_label(self) -> str:
        """The scope as the command line spells it: CODE:YEAR, or a programme's code."""
        if self.edition is not None:
            return str(self.edition)
        return self.programme.code if self.programme is not None else "?"


class Invitation(models.Model):
    """A link that makes its holder `role` staff of one scope, once (apps/roles/invitations.py).

    The scope's columns and the constraint that fits them to the role are
    `RoleAssignment`'s, so an invitation grants nothing a row could not hold.
    The token is kept as its digest alone, as a reset link's is
    (apps/accounts/links.py). The row is deleted once used or revoked, and
    goes with whoever made it: an invitation is good only while its maker may
    grant the role there.
    """

    role = models.CharField(max_length=16, choices=Role.choices, verbose_name=_("role"))
    programme = models.ForeignKey(
        DegreeProgramme,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="invitations",
        verbose_name=_("degree programme"),
    )
    edition = models.ForeignKey(
        CourseEdition,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="invitations",
        verbose_name=_("course edition"),
    )
    token_hash = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="invitations",
        verbose_name=_("invited by"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ("created_at",)
        verbose_name = _("invitation")
        verbose_name_plural = _("invitations")
        constraints = (
            models.CheckConstraint(
                condition=_fits_its_scope(),
                name="roles_invitation_scope_fits_role",
                violation_error_message=_(
                    "A teacher is invited to an edition, secretariat staff to a programme."
                ),
            ),
        )

    def __str__(self) -> str:
        # Never the digest, as `ResetLink`'s.
        return f"invitation #{self.pk} · {self.role} · {self.scope_label}"

    @property
    def scope(self) -> CourseEdition | DegreeProgramme:
        """The edition or the programme the invitation makes its holder staff of."""
        # The check constraint sets one of the two.
        return self.edition if self.edition is not None else cast("DegreeProgramme", self.programme)

    @property
    def scope_label(self) -> str:
        """The scope as `RoleAssignment.scope_label` spells it."""
        scope = self.scope
        return str(scope) if isinstance(scope, CourseEdition) else scope.code
