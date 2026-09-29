"""Admin for role rows: where the superuser grants and revokes any staff role.

The form checks a row against the model's constraints before saving
(`full_clean` validates them), so a teacher entered on a programme is a form
error rather than a database error. Searching an exact username lists
everything that person holds, which is how every role of one person is
revoked at once; the search matches the whole username, so it cannot pull in
someone whose name merely contains it.
"""

from django.contrib import admin

from apps.roles.models import RoleAssignment


@admin.register(RoleAssignment)
class RoleAssignmentAdmin(admin.ModelAdmin):  # pyright: ignore[reportMissingTypeArgument]
    list_display = ("user", "role", "edition", "programme")
    list_filter = ("role",)
    search_fields = ("=user__username",)
    list_select_related = ("user", "edition__course", "programme")
