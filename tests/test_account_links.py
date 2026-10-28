"""A link that resets an account's password (apps/accounts/links.py): made by a superuser,
used once by whoever holds it.

Real requests, as in tests/test_account_sessions.py: what is under test is a
token that travels in a body, the row it opens and the sessions it ends.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import TYPE_CHECKING

import pytest
from django.test import Client
from django.utils import timezone
from test_error_contract import refused

from apps.accounts.models import ResetLink, User

if TYPE_CHECKING:
    from collections.abc import Callable

    from pytest_django import Settings

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery"
NEW_PASSWORD = "lamp-orbit-quietly-87"
ME_URL = "/api/auth/me"
MANAGE_URL = "/api/admin/users"
LOOKUP_URL = "/api/auth/reset/lookup"
RESET_URL = "/api/auth/reset"
JSON = "application/json"


@pytest.fixture(autouse=True)
def _fast_password_hashing(settings: Settings) -> None:
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture
def root() -> User:
    return User.objects.create_superuser(username="root", password=PASSWORD)


@pytest.fixture
def ada() -> User:
    return User.objects.create_user(username="ada", password=PASSWORD)


def signed_in(user: User) -> Client:
    client = Client()
    assert client.login(username=user.get_username(), password=PASSWORD)
    return client


def signed_in_still(*clients: Client) -> list[bool]:
    return [client.get(ME_URL).json()["authenticated"] for client in clients]


def events(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "apps.accounts.events"]


def make_link(root: User, user: User) -> str:
    response = signed_in(root).post(f"{MANAGE_URL}/{user.pk}/reset-link")
    assert response.status_code == 201
    return response.json()["token"]


def deactivated(root: User, ada: User) -> User:
    ada.is_active = False
    ada.save()
    return ada


@pytest.mark.parametrize(
    ("whose", "code"),
    [
        pytest.param(lambda root, ada: ada, None, id="an-account"),
        # Whoever comes back sets a password before being let in again.
        pytest.param(deactivated, None, id="a-deactivated-account"),
        # Its owner changes the password, confirming the one they have.
        pytest.param(lambda root, ada: root, "SELF_NOT_ALLOWED", id="the-callers-own"),
    ],
)
def test_a_superuser_makes_a_reset_link_for_any_account_but_their_own(
    caplog: pytest.LogCaptureFixture,
    root: User,
    ada: User,
    whose: Callable[[User, User], User],
    code: str | None,
) -> None:
    """The token is in the answer and nowhere else: the table keeps its digest,
    and the log names who made the link for whom."""
    user = whose(root, ada)
    admin = signed_in(root)
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        response = admin.post(f"{MANAGE_URL}/{user.pk}/reset-link")

    if code is not None:
        assert (response.status_code, refused(response)) == (409, (code, {}))
        assert not ResetLink.objects.exists()
        assert events(caplog) == []
        return
    assert response.status_code == 201
    body = response.json()
    link = ResetLink.objects.get(user=user)
    assert link.token_hash == hashlib.sha256(body["token"].encode()).hexdigest()
    assert datetime.fromisoformat(body["expires_at"]) == link.expires_at
    left = (link.expires_at - timezone.now()).total_seconds()
    assert left == pytest.approx(24 * 3600, abs=60)
    assert events(caplog) == [
        f"reset_link_created user={user.pk} username='ada' by='root' ip='127.0.0.1'"
    ]


def used(root: User, ada: User) -> str:
    token = make_link(root, ada)
    body = {"token": token, "new_password": PASSWORD + "!"}
    assert Client().post(RESET_URL, body, content_type=JSON).status_code == 204
    return token


def expired(root: User, ada: User) -> str:
    token = make_link(root, ada)
    ResetLink.objects.update(expires_at=timezone.now())
    return token


def replaced(root: User, ada: User) -> str:
    token = make_link(root, ada)
    make_link(root, ada)
    return token


def unknown(root: User, ada: User) -> str:
    make_link(root, ada)
    return "a-token-no-link-was-made-with"


@pytest.mark.parametrize(
    "token_of",
    [
        pytest.param(used, id="used"),
        pytest.param(expired, id="expired"),
        pytest.param(replaced, id="replaced-by-a-newer-one"),
        pytest.param(unknown, id="unknown"),
    ],
)
@pytest.mark.parametrize(
    ("url", "body"),
    [
        pytest.param(LOOKUP_URL, {}, id="lookup"),
        pytest.param(RESET_URL, {"new_password": NEW_PASSWORD}, id="reset"),
    ],
)
def test_a_link_that_does_not_work_is_one_answer_whatever_the_reason(
    root: User, ada: User, token_of: Callable[[User, User], str], url: str, body: dict[str, str]
) -> None:
    token = token_of(root, ada)

    response = Client().post(url, {"token": token, **body}, content_type=JSON)

    assert (response.status_code, refused(response)) == (404, ("LINK_EXPIRED", {}))
    ada.refresh_from_db()
    assert not ada.check_password(NEW_PASSWORD)


def test_a_reset_link_sets_the_password_once_and_signs_the_account_out_everywhere(
    caplog: pytest.LogCaptureFixture, root: User, ada: User
) -> None:
    """Nobody is signed in by it, its holder neither: they sign in with the new
    password, which is the only one that works."""
    phone, laptop = signed_in(ada), signed_in(ada)
    token = make_link(root, ada)
    holder = Client()
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        lookup = holder.post(LOOKUP_URL, {"token": token}, content_type=JSON)
        reset = holder.post(
            RESET_URL, {"token": token, "new_password": NEW_PASSWORD}, content_type=JSON
        )

    assert (lookup.json(), reset.status_code) == ({"username": "ada"}, 204)
    assert signed_in_still(phone, laptop, holder) == [False, False, False]
    ada.refresh_from_db()
    assert (ada.check_password(NEW_PASSWORD), ada.check_password(PASSWORD)) == (True, False)
    assert not ResetLink.objects.exists()
    assert events(caplog) == [
        f"password_reset user={ada.pk} username='ada' sessions=2 ip='127.0.0.1'"
    ]


def test_a_password_the_rules_refuse_leaves_the_link_and_the_sessions_as_they_were(
    root: User, ada: User
) -> None:
    phone = signed_in(ada)
    token = make_link(root, ada)
    holder = Client()

    refusal = holder.post(
        RESET_URL, {"token": token, "new_password": "too-short"}, content_type=JSON
    )

    assert refused(refusal) == ("INVALID_ARGUMENT", {"new_password": ["TOO_SHORT"]})
    assert signed_in_still(phone) == [True]
    assert (
        holder.post(
            RESET_URL, {"token": token, "new_password": NEW_PASSWORD}, content_type=JSON
        ).status_code
        == 204
    )


def test_no_line_of_the_log_holds_a_token(
    caplog: pytest.LogCaptureFixture, root: User, ada: User
) -> None:
    """The token travels in bodies, which nothing logs; every line a link's life
    writes, each refusal's included, is read for it."""
    with caplog.at_level(logging.DEBUG):
        token = make_link(root, ada)
        holder = Client()
        holder.post(LOOKUP_URL, {"token": token}, content_type=JSON)
        holder.post(RESET_URL, {"token": token, "new_password": "too-short"}, content_type=JSON)
        holder.post(RESET_URL, {"token": token, "new_password": NEW_PASSWORD}, content_type=JSON)
        holder.post(RESET_URL, {"token": token, "new_password": NEW_PASSWORD}, content_type=JSON)

    lines = [record.getMessage() for record in caplog.records]
    assert any("LINK_EXPIRED" in line for line in lines)
    assert [line for line in lines if token in line] == []
