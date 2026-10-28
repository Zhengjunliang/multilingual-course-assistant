"""Request parsing and account representation for `/api/auth/`.

DRF serializers in both directions here, unlike apps/qa: these bodies are small
JSON objects that `Response` renders directly, and there is no streaming half
needing a contract of its own.

A refusal here is a code from config/errors.py, never a sentence: the page
words it in the interface's language (docs/api.md, section "Errors").
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.accounts.models import AccountSession, User
from apps.accounts.passwords import set_password_checked
from apps.accounts.sessions import public_id
from apps.roles.scopes import role_scopes
from config.errors import ErrorCode, django_field_error, fail

if TYPE_CHECKING:
    from rest_framework.request import Request


def password_field() -> serializers.CharField:
    """A password, read exactly as typed.

    A `CharField` trims its value by default, which would set and check a
    password other than the one typed (ASVS 6.2.8, outside the repository);
    Django's own forms turn the same off (`strip=False`).
    """
    return serializers.CharField(
        write_only=True, trim_whitespace=False, style={"input_type": "password"}
    )


# `ModelSerializer[User]` rather than a bare `ModelSerializer` in both classes
# below: the stubs declare the model as a type variable, so an unparameterised
# subclass has a `Meta.model` the checker cannot reconcile with the base. DRF's
# own `__class_getitem__` returns the class unchanged, so this is a type
# annotation that happens to be spelled as a base class — nothing about the
# runtime object differs.
class UserSerializer(serializers.ModelSerializer[User]):
    """Who the caller is, and the one thing they may change about it.

    `locale` is writable and nothing else is, which is what makes this serve
    `PATCH /api/auth/me` as well as `GET`. A second serializer for the update
    would be the same two rules written twice, free to disagree. `is_superuser`
    among the read-only fields is what keeps a `PATCH` from granting it.

    `roles` names where the caller holds a staff role (apps/roles/scopes.py),
    and only that: what a role allows on a scope is answered per scope, so the
    SPA never works out a permission from a role name.
    """

    roles = serializers.SerializerMethodField()

    # The suppression is unavoidable, not laziness: the stubs declare six
    # attributes on `ModelSerializer.Meta`, so any real `Meta` — which sets the
    # two or three it needs — is an incompatible override by construction. The
    # rule is right about the shape and wrong about this use of it.
    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = User
        fields = ("id", "username", "locale", "is_superuser", "roles")
        read_only_fields = ("id", "username", "is_superuser")

    def get_roles(self, user: User) -> list[dict[str, object]]:
        return role_scopes(user)


class RegisterSerializer(serializers.ModelSerializer[User]):
    """Open self-registration: anyone who can reach the page can make an account.

    A `ModelSerializer` so the username rules come from the model itself —
    length, the character validator, and above all uniqueness, which a
    hand-written serializer would let through to an IntegrityError and a 500.
    """

    password = password_field()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = User
        fields = ("username", "password", "locale")

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """The account, unsaved, with its password checked and hashed onto it.

        In `validate()` and not `validate_password`, because one of
        `AUTH_PASSWORD_VALIDATORS` judges the password against the account (a
        password close to the username is refused), and only here are both
        known. Bridged by hand because the two frameworks raise different
        exceptions with the same name: Django's would escape as a 500, and only
        DRF's becomes the 400 that tells the caller which rule they broke, each
        by its code (config/errors.py).
        """
        password = attrs.pop("password")
        user = User(**attrs)
        # What `create_user` would do to the name, which this path replaces.
        user.username = User.normalize_username(user.username)
        try:
            set_password_checked(user, password)
        except DjangoValidationError as exc:
            raise django_field_error(exc, field="password") from exc
        return {"user": user}

    def create(self, validated_data: dict[str, Any]) -> User:
        # Hashed already, by `set_password_checked`: `save` stores the hash,
        # never the password as typed.
        user: User = validated_data["user"]
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    """Credentials in, an authenticated user out."""

    username = serializers.CharField()
    password = password_field()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        request: Request | None = self.context.get("request")
        user = authenticate(request=request, username=attrs["username"], password=attrs["password"])
        if user is None:
            # One message for a wrong password and for a username that was never
            # registered. Telling them apart hands out an account-enumeration
            # oracle, and the caller cannot act on the difference anyway.
            fail(ErrorCode.WRONG_CREDENTIALS)
        attrs["user"] = user
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    """The password as it is, confirming who asks, and the one to replace it.

    Checked in the view and not here: the current password first, so the
    rules on the new one answer nobody but the account's owner.
    """

    password = password_field()
    new_password = password_field()


class EndSessionsSerializer(serializers.Serializer):
    """The password, confirming who asks, and which session to end.

    `session` is the `id` a row of the list carries, or `others` for every
    session of the account but the caller's.
    """

    password = password_field()
    session = serializers.CharField()


class DeleteAccountSerializer(serializers.Serializer):
    """The password, confirming who asks to delete the account."""

    password = password_field()


class LinkSerializer(serializers.Serializer):
    """The token of a link (apps/accounts/links.py), as the page read it off the link."""

    token = serializers.CharField()


class AcceptAsSerializer(LinkSerializer):
    """An invitation's token, and the id of the account signed in that accepts it."""

    account = serializers.IntegerField()


class PasswordResetSerializer(LinkSerializer):
    """A reset link's token, and the password it sets."""

    new_password = password_field()


class InvitedAccountSerializer(RegisterSerializer):
    """An invitation's token, and the account accepting it makes, checked as registering does."""

    token = serializers.CharField(write_only=True)

    class Meta(RegisterSerializer.Meta):  # pyright: ignore[reportIncompatibleVariableOverride]
        fields = ("token", *RegisterSerializer.Meta.fields)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        token = attrs.pop("token")
        return {**super().validate(attrs), "token": token}


class AccountSessionSerializer(serializers.ModelSerializer[AccountSession]):
    """A row of the device list; `current` is the session the list was asked from."""

    id = serializers.SerializerMethodField()
    current = serializers.SerializerMethodField()

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = AccountSession
        fields = ("id", "current", "user_agent", "ip", "authenticated_at", "last_activity")
        read_only_fields = fields

    def get_id(self, session: AccountSession) -> str:
        return public_id(session.session_key)

    def get_current(self, session: AccountSession) -> bool:
        return session.session_key == self.context["current"]
