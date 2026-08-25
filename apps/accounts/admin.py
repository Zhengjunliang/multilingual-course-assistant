"""Admin registration for the swapped-in user model.

Django ships `UserAdmin` bound to `auth.User`; once the model is swapped it has
to be registered again against the new one.

`fieldsets` extends the inherited layout instead of restating it: that layout is
long, and a frozen copy would drift silently the first time Django reorganises
it. `list_display` is restated instead, because `ModelAdmin` is generic in the
model it administers and reading a generic instance variable off the bare class
is ambiguous — the five names it holds have been stable for many releases, so a
copy costs less than the alternative.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.translation import gettext_lazy as _

from apps.accounts.models import User


@admin.register(User)
class AccountUserAdmin(UserAdmin):
    # `or ()` is not defensive padding: BaseModelAdmin declares `fieldsets` as
    # optional, so unpacking it without the fallback is an error even though
    # UserAdmin always sets it.
    fieldsets = (
        *(UserAdmin.fieldsets or ()),
        (_("Language"), {"fields": ("locale",)}),
    )
    add_fieldsets = (
        *(UserAdmin.add_fieldsets or ()),
        (_("Language"), {"fields": ("locale",)}),
    )
    list_display = ("username", "email", "first_name", "last_name", "is_staff", "locale")
    list_filter = (*UserAdmin.list_filter, "locale")
