"""The authentication backend that answers scoped permissions from role rows.

Django's hook for per-object permissions is a backend whose permission methods
take the object; django-guardian and django-rules plug in the same way. This
one authenticates nobody (`BaseBackend.authenticate` and `get_user` return
None), so it sits after `ModelBackend` in `AUTHENTICATION_BACKENDS`: a session
records the first backend that can load its user, and it must be that one.

Only `get_user_permissions` is overridden. `has_perm`, `ahas_perm` and
`get_all_permissions` come from `BaseBackend`, which derives each from it, so
every way Django asks gets one answer, the one apps/roles/scopes.py computes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.contrib.auth.backends import BaseBackend

from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.roles.scopes import held_on

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from django.contrib.auth.models import AnonymousUser
    from django.db.models import Model


class RoleBackend(BaseBackend):
    def get_user_permissions(
        self, user_obj: AbstractBaseUser | AnonymousUser, obj: Model | None = None
    ) -> set[str]:
        # A scoped permission needs its scope: without an object, or on an
        # object that is not a scope, a role grants nothing.
        if isinstance(obj, CourseEdition | DegreeProgramme):
            return set(held_on(user_obj, obj))
        return set()
