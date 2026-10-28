"""The password rule Django ships no validator for: an upper bound on length.

Shaped as Django's own `MinimumLengthValidator` is, so `AUTH_PASSWORD_VALIDATORS`
lists it beside the others (config/settings.py says why 128). Its message is
English and never translated: the page words a refusal from its code,
`TOO_LONG` with the bound (config/errors.py).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.core.exceptions import ValidationError

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser


class MaximumLengthValidator:
    def __init__(self, max_length: int = 128) -> None:
        self.max_length = max_length

    def validate(self, password: str, user: AbstractBaseUser | None = None) -> None:
        if len(password) > self.max_length:
            raise ValidationError(
                "This password is longer than %(max_length)d characters.",
                code="password_too_long",
                params={"max_length": self.max_length},
            )

    def get_help_text(self) -> str:
        return f"Your password must contain at most {self.max_length} characters."
