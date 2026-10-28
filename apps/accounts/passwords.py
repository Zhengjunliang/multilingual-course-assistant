"""Setting a password: every path that sets one goes through `set_password_checked`.

`AUTH_PASSWORD_VALIDATORS` (config/settings.py) reach nothing on their own:
`User.set_password` hashes whatever it is given. One function that checks and
then hashes keeps a new way of setting a password from skipping the rules.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.contrib.auth.password_validation import validate_password

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser


def set_password_checked(user: AbstractBaseUser, raw: str) -> None:
    """Checks `raw` against the rules, judged against `user`, then hashes it onto `user`.

    With the account, because one rule needs it: a password close to the
    username is refused. The caller saves `user`; a password the rules refuse
    raises Django's `ValidationError`, each rule by its code.
    """
    validate_password(raw, user=user)
    user.set_password(raw)
