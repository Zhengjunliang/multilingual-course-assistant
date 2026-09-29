"""The admin site: the superuser's back office, and nobody else's.

Staff work in the SPA, inside their scope (apps/roles/); the admin edits every
row of every table, so a scope cannot be drawn in it, and Django's own
documentation keeps it to an organisation's internal management tool
(docs/decisions.md, 2026-09-29, *Staff permissions are a registry in code,
answered by one backend; the admin is the superuser's*, point 3).

`is_staff` stays in the test rather than being replaced by `is_superuser`:
Django's admin login form refuses a user who is not staff, and a superuser
created by `createsuperuser` is both.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from django.contrib import admin

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.accounts.models import User


class SuperuserAdminSite(admin.AdminSite):
    def has_permission(self, request: HttpRequest) -> bool:
        # Past the first test the caller is an active staff account, so the
        # cast only tells pyright what `AUTH_USER_MODEL` is (apps/accounts/views.py).
        return super().has_permission(request) and cast("User", request.user).is_superuser
