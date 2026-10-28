"""Admin registration for the swapped-in user model.

Django ships `UserAdmin` bound to `auth.User`; once the model is swapped it has
to be registered again against the new one.

`fieldsets` extends the inherited layout instead of restating it: that layout is
long, and a frozen copy would drift silently the first time Django reorganises
it. Its first group alone is restated, without the password. `list_display` is
restated instead, because `ModelAdmin` is generic in the model it administers
and reading a generic instance variable off the bare class is ambiguous — the
five names it holds have been stable for many releases, so a copy costs less
than the alternative.

An account is opened by its owner signing up, and its password set by its
owner alone: the add page and the password page answer 403, and the change
page shows no password. Deactivating, reactivating and deleting go through
apps/accounts/services.py, which ends the account's sessions and holds the
rules; a change the rules forbid is not offered (`refusal`).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, NoReturn, cast

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.core.exceptions import PermissionDenied
from django.utils.translation import gettext_lazy as _

from apps.accounts import services
from apps.accounts.models import User

if TYPE_CHECKING:
    from django.forms import ModelForm
    from django.http import HttpRequest


def actor(request: HttpRequest) -> User:
    # Past the site's own test the caller is an active superuser (config/admin.py),
    # so the cast only tells pyright what `AUTH_USER_MODEL` is.
    return cast("User", request.user)


@admin.register(User)
class AccountUserAdmin(UserAdmin):
    # `or ()` is not defensive padding: BaseModelAdmin declares `fieldsets` as
    # optional, so unpacking it without the fallback is an error even though
    # UserAdmin always sets it.
    fieldsets = (
        (None, {"fields": ("username",)}),
        *(UserAdmin.fieldsets or ())[1:],
        (_("Language"), {"fields": ("locale",)}),
    )
    list_display = ("username", "email", "first_name", "last_name", "is_staff", "locale")
    list_filter = (*UserAdmin.list_filter, "locale")
    # No bulk action, so none deletes: Django's bulk delete asks no rule of
    # each account, and reports every one selected as deleted. An account is
    # deleted from its own page, which asks first (`has_delete_permission`).
    actions = None

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def user_change_password(self, request: HttpRequest, id: str, form_url: str = "") -> NoReturn:
        raise PermissionDenied

    def get_readonly_fields(self, request: HttpRequest, obj: Any = None) -> Any:
        fields = super().get_readonly_fields(request, obj)
        # Shown but not editable where taking them away is refused: the
        # caller's own account.
        if obj is not None and services.refusal(actor(request), obj) is not None:
            return (*fields, "is_active", "is_superuser")
        return fields

    def save_model(self, request: HttpRequest, obj: User, form: ModelForm, change: bool) -> None:
        super().save_model(request, obj, form, change)
        if change and "is_active" in form.changed_data:
            change_access = services.activate if obj.is_active else services.deactivate
            change_access(actor(request), obj, request)

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        # Asked of an account before its delete page is shown, and again when
        # the deletion is confirmed.
        if obj is not None and services.refusal(actor(request), obj, delete=True) is not None:
            return False
        return super().has_delete_permission(request, obj)

    def delete_model(self, request: HttpRequest, obj: User) -> None:
        services.delete_account(actor(request), obj, request)
