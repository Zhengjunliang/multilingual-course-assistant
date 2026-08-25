"""Guards on the swapped-in user model."""

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.accounts.models import User


def test_custom_user_model_is_wired() -> None:
    """`AUTH_USER_MODEL` must resolve here and not to `django.contrib.auth.User`.

    Silent fallback is the failure mode worth guarding: everything keeps working
    until the day a `locale` is expected on a user and is not there.
    """
    assert get_user_model() is User


@pytest.mark.django_db
def test_user_defaults_to_the_project_locale() -> None:
    """A user carries a language from the moment it exists — the domain is multilingual."""
    user = User.objects.create_user(username="ada")

    assert user.locale == settings.LANGUAGE_CODE


@pytest.mark.django_db
def test_user_locale_rejects_a_language_the_project_does_not_serve() -> None:
    """`choices` is only enforced through validation, so the enforcement is what is tested."""
    user = User(username="grace", locale="xx")

    with pytest.raises(ValidationError) as excinfo:
        user.full_clean()

    assert "locale" in excinfo.value.error_dict


@pytest.mark.django_db
def test_no_pending_migrations() -> None:
    """A model edited without `makemigrations` would only surface as a runtime error.

    `--check` exits non-zero when the models and the migrations have drifted
    apart; CI runs the same command, this pins it to the local run too.
    """
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)
