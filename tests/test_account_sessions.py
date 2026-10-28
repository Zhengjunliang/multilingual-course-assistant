"""Sessions keyed to their account (apps/accounts/sessions.py), and the changes that end them.

Real logins, as in tests/test_accounts_api.py: what is under test is the row a
sign-in writes and the request that no longer finds it. The account changes
are made through `/admin/`, their one door until #167 opens the SPA's; the
rules they obey are apps/accounts/services.py's.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession, User
from apps.accounts.sessions import USER_AGENT_MAX_LENGTH

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http.response import HttpResponseBase
    from pytest_django import Settings

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery"
ME_URL = "/api/auth/me"
USERS_URL = "/admin/accounts/user/"


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


def save_change_page(admin: Client, user: User, **flags: bool) -> HttpResponseBase:
    """Saves `user`'s change page with `flags` and every other flag as the account holds it."""
    held = {flag: getattr(user, flag) for flag in ("is_active", "is_staff", "is_superuser")}
    data = {
        "username": user.get_username(),
        "date_joined_0": "2026-10-28",
        "date_joined_1": "09:00:00",
        "locale": user.locale,
        **{flag: "on" for flag, on in (held | flags).items() if on},
    }
    return admin.post(f"{USERS_URL}{user.pk}/change/", data)


@pytest.mark.parametrize(
    ("sent", "user_agent", "ip"),
    [
        pytest.param("Firefox/131.0", "Firefox/131.0", "127.0.0.1", id="api"),
        pytest.param(
            "x" * (USER_AGENT_MAX_LENGTH + 1),
            "x" * USER_AGENT_MAX_LENGTH,
            "127.0.0.1",
            id="a-user-agent-longer-than-its-column",
        ),
        # The test client's own sign-in, which builds a request with no META.
        pytest.param(None, "", None, id="force-login"),
    ],
)
def test_a_sign_in_saves_whose_session_it_is_from_where_and_when(
    ada: User, sent: str | None, user_agent: str, ip: str | None
) -> None:
    client = APIClient()
    if sent is None:
        client.force_login(ada)
    else:
        credentials = {"username": "ada", "password": PASSWORD}
        response = client.post("/api/auth/login", credentials, format="json", HTTP_USER_AGENT=sent)
        assert response.status_code == 200

    [session] = AccountSession.objects.all()
    assert (session.user, session.user_agent, session.ip) == (ada, user_agent, ip)
    assert session.authenticated_at is not None
    assert session.last_activity == session.authenticated_at
    assert timezone.now() - session.authenticated_at < timedelta(minutes=1)


def deactivate_in_the_admin(admin: Client, user: User) -> None:
    assert save_change_page(admin, user, is_active=False).status_code == 302


def deactivate_behind_its_back(admin: Client, user: User) -> None:
    User.objects.filter(pk=user.pk).update(is_active=False)


DEACTIVATED = "deactivate user={pk} username='ada' by='root' sessions=2 ip='127.0.0.1'"
REACTIVATED = "activate user={pk} username='ada' by='root' ip='127.0.0.1'"


@pytest.mark.parametrize(
    ("deactivate", "sessions_left", "lines"),
    [
        pytest.param(deactivate_in_the_admin, 0, [DEACTIVATED, REACTIVATED], id="in-the-admin"),
        # A shell or a bulk `.update()`, which the rules never see: the
        # account's sessions outlive it, and only the reactivation ends them.
        pytest.param(deactivate_behind_its_back, 2, [REACTIVATED], id="behind-the-admins-back"),
    ],
)
def test_a_deactivated_account_is_signed_out_everywhere_and_signs_in_afresh_once_reactivated(
    caplog: pytest.LogCaptureFixture,
    root: User,
    ada: User,
    deactivate: Callable[[Client, User], None],
    sessions_left: int,
    lines: list[str],
) -> None:
    """AC-A2 and AC-F3: the second device as well as the first, and none comes back."""
    phone, laptop, admin = signed_in(ada), signed_in(ada), signed_in(root)
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        deactivate(admin, ada)
        assert signed_in_still(phone, laptop) == [False, False]
        assert AccountSession.objects.filter(user=ada).count() == sessions_left

        ada.refresh_from_db()
        assert save_change_page(admin, ada, is_active=True).status_code == 302

    assert signed_in_still(phone, laptop) == [False, False]
    assert not AccountSession.objects.filter(user=ada).exists()
    seen = [r.getMessage() for r in caplog.records if r.name == "apps.accounts.events"]
    assert seen == [line.format(pk=ada.pk) for line in lines]


def pk(username: str) -> int:
    return User.objects.get(username=username).pk


@pytest.mark.parametrize(
    ("act", "status"),
    [
        # The two flags are shown, not editable, on the caller's own page:
        # the page saves, and they are as they were.
        pytest.param(
            lambda admin: save_change_page(
                admin, User.objects.get(username="root"), is_active=False, is_superuser=False
            ),
            302,
            id="take-your-own-access-away",
        ),
        pytest.param(
            lambda admin: admin.post(f"{USERS_URL}{pk('root')}/delete/", {"post": "yes"}),
            403,
            id="delete-yourself",
        ),
        pytest.param(
            lambda admin: admin.post(f"{USERS_URL}{pk('ada')}/delete/", {"post": "yes"}),
            403,
            id="delete-an-active-account",
        ),
        # Not offered: with no action left, the list answers the form by
        # showing itself again, and deletes nothing.
        pytest.param(
            lambda admin: admin.post(
                USERS_URL,
                {
                    "action": "delete_selected",
                    "_selected_action": [pk("grace")],
                    "index": 0,
                    "post": "yes",
                },
            ),
            200,
            id="delete-in-bulk",
        ),
        pytest.param(lambda admin: admin.get(f"{USERS_URL}add/"), 403, id="open-an-account"),
        pytest.param(
            lambda admin: admin.get(f"{USERS_URL}{pk('ada')}/password/"),
            403,
            id="set-a-password",
        ),
    ],
)
def test_the_admin_refuses_what_the_account_rules_forbid(
    root: User, ada: User, act: Callable[[Client], HttpResponseBase], status: int
) -> None:
    User.objects.create_user(username="grace", password=PASSWORD, is_active=False)
    admin = signed_in(root)
    accounts = User.objects.order_by("pk").values_list("username", "is_active", "is_superuser")
    before = list(accounts)

    response = act(admin)

    assert (response.status_code, list(accounts)) == (status, before)


def test_an_account_deactivated_first_is_deleted_from_its_own_page(
    caplog: pytest.LogCaptureFixture, root: User, ada: User
) -> None:
    """AC-A3: deleting comes second, and leaves its line."""
    admin = signed_in(root)
    User.objects.filter(pk=ada.pk).update(is_active=False)
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        response = admin.post(f"{USERS_URL}{ada.pk}/delete/", {"post": "yes"})

    assert response.status_code == 302
    assert not User.objects.filter(username="ada").exists()
    [line] = [r.getMessage() for r in caplog.records if r.name == "apps.accounts.events"]
    assert line.startswith(f"delete user={ada.pk} username='ada' by='root'")
