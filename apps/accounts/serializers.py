"""Request parsing and account representation for `/api/auth/`.

DRF serializers in both directions here, unlike apps/qa: these bodies are small
JSON objects that `Response` renders directly, and there is no streaming half
needing a contract of its own.

Every message is wrapped in `gettext_lazy`. Nothing translates them yet — the
catalogues arrive with the deployment stage, the same state apps/qa/engine.py
describes — but a string that was never marked is one that has to be hunted
down later instead of collected by `makemessages`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from apps.accounts.models import User

if TYPE_CHECKING:
    from rest_framework.request import Request


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
    would be the same two rules written twice, free to disagree.
    """

    # The suppression is unavoidable, not laziness: the stubs declare six
    # attributes on `ModelSerializer.Meta`, so any real `Meta` — which sets the
    # two or three it needs — is an incompatible override by construction. The
    # rule is right about the shape and wrong about this use of it.
    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = User
        fields = ("id", "username", "locale")
        read_only_fields = ("id", "username")


class RegisterSerializer(serializers.ModelSerializer[User]):
    """Open self-registration: anyone who can reach the page can make an account.

    A `ModelSerializer` so the username rules come from the model itself —
    length, the character validator, and above all uniqueness, which a
    hand-written serializer would let through to an IntegrityError and a 500.
    """

    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:  # pyright: ignore[reportIncompatibleVariableOverride]
        model = User
        fields = ("username", "password", "locale")

    def validate_password(self, value: str) -> str:
        """Django's own validators — the four `AUTH_PASSWORD_VALIDATORS` lists.

        Bridged by hand because the two frameworks raise different exceptions
        with the same name: Django's would escape as a 500, and only DRF's
        becomes the 400 that tells the caller which rule they broke.
        """
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data: dict[str, Any]) -> User:
        # `create_user`, never `create`: it is what hashes the password. `create`
        # would store it as typed and every later login would fail — the quiet
        # half of that mistake being that the plaintext is now in the database.
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    """Credentials in, an authenticated user out."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        request: Request | None = self.context.get("request")
        user = authenticate(request=request, username=attrs["username"], password=attrs["password"])
        if user is None:
            # One message for a wrong password and for a username that was never
            # registered. Telling them apart hands out an account-enumeration
            # oracle, and the caller cannot act on the difference anyway.
            raise serializers.ValidationError(_("Wrong username or password."))
        attrs["user"] = user
        return attrs
