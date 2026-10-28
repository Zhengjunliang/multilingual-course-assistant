"""An account as a superuser sees it on the site's account list (apps/accounts/manage_views.py).

Apart from apps/accounts/serializers.py, which is the caller's own account:
this one is everybody's, read by the one role that manages them.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.accounts.models import User
from apps.roles.scopes import role_scope

# Where the list puts each account's role rows, fetched for the whole page at once.
ROLE_ROWS = "role_rows"


class ManagedUserSerializer(serializers.ModelSerializer[User]):
    """A row of the account list.

    `roles` has the shape of `me`'s (apps/roles/scopes.py, `role_scope`), read
    off the rows the list fetched (`ROLE_ROWS`, ordered as `ROLE_ORDER`), never
    queried per account.
    """

    roles = serializers.SerializerMethodField()

    # The suppression apps/accounts/serializers.py explains.
    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = User
        fields = (
            "id",
            "username",
            "is_active",
            "is_superuser",
            "last_login",
            "date_joined",
            "roles",
        )
        read_only_fields = fields

    def get_roles(self, user: User) -> list[dict[str, object]]:
        return [
            role_scope(row.role, row.edition_id, row.programme.code if row.programme else None)
            for row in getattr(user, ROLE_ROWS)
        ]


class ResetLinkSerializer(serializers.Serializer):
    """A reset link just made (apps/accounts/links.py): the one time its token is shown."""

    token = serializers.CharField(read_only=True)
    expires_at = serializers.DateTimeField(read_only=True)
