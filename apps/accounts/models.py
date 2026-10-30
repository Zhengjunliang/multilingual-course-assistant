"""The project's user model, the sessions signed in to it, the link that resets its
password, and the programme it says it studies in.

Swapped in before the first `migrate` on purpose: `contrib.auth` and `admin`
declare their dependency on the user model through `swappable_dependency`, so a
custom model has to exist and be migrated for those dependencies to resolve.
"""

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.contrib.sessions.base_session import AbstractBaseSession
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.accounts.sessions import USER_AGENT_MAX_LENGTH, SessionStore
from apps.catalog.models import (
    FIRST_YEAR_OF_STUDY,
    LAST_YEAR_OF_STUDY,
    YEAR_OF_STUDY_MESSAGE,
    DegreeProgramme,
)


class User(AbstractUser):
    """`AbstractUser` plus the one field the domain forces on every model.

    Questions arrive in any language and are answered in that same language, so
    nothing user-facing may assume a single one. `locale` is the account's
    preference — it drives the interface and breaks the tie when a question
    carries no language signal of its own. Per-question detection stays in
    `rag/`, which knows nothing about this model.
    """

    locale = models.CharField(
        max_length=16,
        choices=settings.LANGUAGES,
        default=settings.LANGUAGE_CODE,
        verbose_name=_("preferred language"),
        help_text=_("Language for the interface and for generated answers."),
    )


class AccountSession(AbstractBaseSession):
    """A session, saved by the engine of apps/accounts/sessions.py.

    Every column past Django's three is projected from the session's data on
    each save; none is written on its own. A session nobody signed in to has
    no `user`, and is a visitor's.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE, related_name="sessions"
    )
    user_agent = models.CharField(max_length=USER_AGENT_MAX_LENGTH, blank=True)
    ip = models.GenericIPAddressField(null=True)
    authenticated_at = models.DateTimeField(null=True)
    last_activity = models.DateTimeField(null=True)

    # The column Django adds for the key, declared for the type checker, which
    # does not see it: the engine sets the key it reads off the session's data.
    user_id: int | None

    @classmethod
    def get_session_store_class(cls) -> type[SessionStore]:
        return SessionStore


class ResetLink(models.Model):
    """A link that sets its account's password once (apps/accounts/links.py).

    One per account at most, so a new link replaces the one before it. The
    token is kept as its digest alone, so a copy of the table resets nothing.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reset_link"
    )
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()

    def __str__(self) -> str:
        # Never the digest: whatever prints a row has no use for it.
        return f"reset link #{self.pk}"


class StudentProgramme(models.Model):
    """The degree programme an account says it studies in, and its year (#36).

    What a search reads by default follows from it (apps/qa/scope.py). The
    person declares it, at registration or on the account page, so it keeps a
    search consistent and protects nothing (docs/data-model.md, scope
    invariant 3); a university identity (#44) would write this table and no
    other. Apart from `User`, as Open edX keeps a `ProgramEnrollment` and
    Django's documentation advises for an app's own data about a user
    (outside the repository). No row is no programme. `year_of_study` orders
    the course list, and decides nothing.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="student_programme"
    )
    # CASCADE: a programme gone from the catalogue is one nobody studies in any more.
    programme = models.ForeignKey(
        DegreeProgramme,
        on_delete=models.CASCADE,
        related_name="+",
        verbose_name=_("degree programme"),
    )
    year_of_study = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=(
            MinValueValidator(FIRST_YEAR_OF_STUDY),
            MaxValueValidator(LAST_YEAR_OF_STUDY),
        ),
        verbose_name=_("year of study"),
    )

    # The columns Django adds for the keys, declared for the type checker, which does not see them.
    user_id: int
    programme_id: int

    class Meta:
        verbose_name = _("student programme")
        verbose_name_plural = _("student programmes")
        constraints = (
            models.CheckConstraint(
                condition=models.Q(year_of_study__isnull=True)
                | models.Q(
                    year_of_study__gte=FIRST_YEAR_OF_STUDY, year_of_study__lte=LAST_YEAR_OF_STUDY
                ),
                name="accounts_programme_year_of_study_range",
                violation_error_message=YEAR_OF_STUDY_MESSAGE,
            ),
        )

    def __str__(self) -> str:
        return f"{self.user_id} {self.programme_id}"

    @classmethod
    def declare(
        cls, user: User, *, programme: DegreeProgramme | None, year_of_study: int | None
    ) -> None:
        """Store what `user` declares: a programme and its year, or no programme at all."""
        if programme is None:
            cls.objects.filter(user=user).delete()
            return
        cls.objects.update_or_create(
            user=user, defaults={"programme": programme, "year_of_study": year_of_study}
        )
