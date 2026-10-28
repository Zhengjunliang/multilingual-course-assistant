"""Sessions keyed to their account (apps/accounts/sessions.py), and what ends them.

Real logins, as in tests/test_accounts_api.py: what is under test is the row a
sign-in writes and the request that no longer finds it. A session ends by its
tier's limits (apps/accounts/middleware.py), by its owner's hand
(apps/accounts/self_views.py), or with its account: the account changes are
made through `/admin/`, their one door until #167 opens the SPA's, under the
rules of apps/accounts/services.py. A session's age is moved back in its
stored data, not by a frozen clock: the limits are read off that data.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession, User
from apps.accounts.sessions import AUTH_AT, SEEN_AT, USER_AGENT_MAX_LENGTH, public_id
from apps.catalog.models import Course, CourseEdition
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http.response import HttpResponseBase
    from pytest_django import Settings

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery"
ME_URL = "/api/auth/me"
LOGIN_URL = "/api/auth/login"
PASSWORD_URL = "/api/auth/password"
SESSIONS_URL = "/api/auth/sessions"
END_URL = "/api/auth/sessions/end"
# Any route that needs a session, for what a signed-out caller gets: a 401.
CONVERSATIONS_URL = "/api/conversations"
USERS_URL = "/admin/accounts/user/"

ZERO, MINUTE, HOUR, DAY = timedelta(0), timedelta(minutes=1), timedelta(hours=1), timedelta(days=1)


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


def device(user: User, name: str) -> Client:
    """A browser calling itself `name`, signed in as `user` through the API."""
    client = Client(headers={"user-agent": name})
    credentials = {"username": user.get_username(), "password": PASSWORD}
    assert client.post(LOGIN_URL, credentials, content_type="application/json").status_code == 200
    return client


def signed_in_still(*clients: Client) -> list[bool]:
    return [client.get(ME_URL).json()["authenticated"] for client in clients]


def key(client: Client) -> str:
    return client.cookies[settings.SESSION_COOKIE_NAME].value


def age(client: Client, *, signed_in: timedelta | None = ZERO, seen: timedelta = ZERO) -> None:
    """Moves back when the client's session was signed in, None for never, and last seen."""
    session = client.session
    if signed_in is None:
        del session[AUTH_AT]
    else:
        session[AUTH_AT] -= int(signed_in.total_seconds())
    session[SEEN_AT] -= int(seen.total_seconds())
    session.save()


def events(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "apps.accounts.events"]


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
    assert timezone.now() - session.authenticated_at < MINUTE
    # A student's idle limit from the start, before any request refreshes it.
    assert session.expire_date == session.authenticated_at + 7 * DAY


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
    assert events(caplog) == [line.format(pk=ada.pk) for line in lines]


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
        # Django's own form for the caller's password, which nothing here
        # throttles or logs: the SPA's is `POST /api/auth/password`.
        pytest.param(
            lambda admin: admin.post(
                "/admin/password_change/",
                {
                    "old_password": PASSWORD,
                    "new_password1": "lamp-orbit-quietly-87",
                    "new_password2": "lamp-orbit-quietly-87",
                },
            ),
            403,
            id="change-your-own-password",
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
    [line] = events(caplog)
    assert line.startswith(f"delete user={ada.pk} username='ada' by='root'")


@pytest.mark.parametrize(
    ("who", "since_sign_in", "since_seen", "reason"),
    [
        pytest.param("ada", 13 * DAY, 6 * DAY, None, id="a-student-within-her-limits"),
        pytest.param("ada", 7 * DAY, 7 * DAY, "idle", id="a-student-idle-a-week"),
        pytest.param("ada", 14 * DAY, ZERO, "absolute", id="a-student-fourteen-days-on"),
        pytest.param("root", 23 * HOUR, 59 * MINUTE, None, id="staff-within-their-limits"),
        pytest.param("root", HOUR, HOUR, "idle", id="staff-idle-an-hour"),
        pytest.param("root", DAY, ZERO, "absolute", id="staff-a-day-on"),
        pytest.param("ada", None, ZERO, "unstamped", id="a-session-no-sign-in-wrote"),
    ],
)
def test_a_session_ends_at_its_tiers_limits(
    caplog: pytest.LogCaptureFixture,
    request: pytest.FixtureRequest,
    who: str,
    since_sign_in: timedelta | None,
    since_seen: timedelta,
    reason: str | None,
) -> None:
    """AC-F4. Read off the session's own data: an expiry Django has not reached
    yet does not keep alive a session past its limits."""
    user: User = request.getfixturevalue(who)
    client = signed_in(user)
    age(client, signed_in=since_sign_in, seen=since_seen)
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        response = client.get(CONVERSATIONS_URL)

    named = f"user={user.pk} username={who!r}"
    lines = [f"expired {named} reason={reason!r} ip='127.0.0.1'", f"logout {named} ip='127.0.0.1'"]
    expected = (401, lines) if reason else (200, [])
    assert (response.status_code, events(caplog)) == expected


@pytest.mark.parametrize(
    ("since_sign_in", "counted_from", "limit"),
    [
        pytest.param(2 * HOUR, "last_activity", HOUR, id="the-idle-limit-from-now"),
        pytest.param(23 * HOUR + 30 * MINUTE, "authenticated_at", DAY, id="the-absolute-one"),
    ],
)
def test_a_refresh_moves_the_expiry_to_the_nearer_of_the_tiers_limits(
    root: User, since_sign_in: timedelta, counted_from: str, limit: timedelta
) -> None:
    """The deadline Django loads a session by, and the device list lists it by.
    Seen over a minute ago, so the request refreshes the session."""
    client = signed_in(root)
    age(client, signed_in=since_sign_in, seen=2 * MINUTE)

    assert client.get(ME_URL).json()["authenticated"] is True
    [session] = AccountSession.objects.all()
    assert session.expire_date == getattr(session, counted_from) + limit
    assert timezone.now() - session.last_activity < MINUTE


@pytest.mark.parametrize(
    ("since_seen", "limits"),
    [
        # Within a minute of the last refresh, refreshed all the same.
        pytest.param(ZERO, [HOUR], id="refreshed-to-staffs-idle-limit"),
        pytest.param(2 * HOUR, [], id="signed-out-two-hours-idle"),
    ],
)
def test_a_role_granted_mid_session_holds_it_to_staffs_limits_from_the_next_request(
    ada: User, since_seen: timedelta, limits: list[timedelta]
) -> None:
    client = signed_in(ada)
    age(client, seen=since_seen)
    course = Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")
    edition = CourseEdition.objects.create(course=course, academic_year="2025-2026")
    RoleAssignment.objects.create(user=ada, role=Role.TEACHER, edition=edition)

    assert client.get(ME_URL).json()["authenticated"] is bool(limits)
    sessions = AccountSession.objects.filter(user=ada)
    assert [s.expire_date - s.last_activity for s in sessions] == limits


def test_signing_in_again_counts_the_absolute_limit_afresh(ada: User) -> None:
    """`login()` keeps the data of a session signed in to the same account."""
    client = device(ada, "Firefox/131.0")
    age(client, signed_in=13 * DAY)

    credentials = {"username": "ada", "password": PASSWORD}
    assert client.post(LOGIN_URL, credentials, content_type="application/json").status_code == 200

    [session] = AccountSession.objects.all()
    assert timezone.now() - session.authenticated_at < MINUTE


def test_the_device_list_shows_the_accounts_live_sessions_and_marks_the_callers(
    ada: User, root: User
) -> None:
    """AC-M3: one row per session still alive, the most recently used first,
    named by an id that is not its cookie."""
    phone, laptop, tablet = device(ada, "Phone"), device(ada, "Laptop"), device(ada, "Tablet")
    signed_in(root)
    age(phone, seen=5 * MINUTE)
    # Past its expiry, which Django loads no session after.
    past = timezone.now() - MINUTE
    AccountSession.objects.filter(session_key=key(tablet)).update(expire_date=past)

    rows = laptop.get(SESSIONS_URL).json()

    assert [(row["id"], row["user_agent"], row["ip"], row["current"]) for row in rows] == [
        (public_id(key(laptop)), "Laptop", "127.0.0.1", True),
        (public_id(key(phone)), "Phone", "127.0.0.1", False),
    ]
    fields = {"id", "current", "user_agent", "ip", "authenticated_at", "last_activity"}
    assert set(rows[0]) == fields
    assert key(phone) not in str(rows)


NEW_PASSWORD = "lamp-orbit-quietly-87"


@pytest.mark.parametrize(
    ("password", "status", "phone_in", "line"),
    [
        pytest.param(
            PASSWORD,
            204,
            False,
            "password_changed user={pk} username='ada' sessions=1 ip='127.0.0.1'",
            id="the-password-confirmed",
        ),
        pytest.param(
            "not-the-password",
            400,
            True,
            "reauth_failed user={pk} username='ada' ip='127.0.0.1'",
            id="a-wrong-password",
        ),
    ],
)
def test_changing_the_password_keeps_this_session_and_ends_the_others(
    caplog: pytest.LogCaptureFixture,
    ada: User,
    password: str,
    status: int,
    phone_in: bool,
    line: str,
) -> None:
    """AC-M2. The other devices are signed out at their next request, and their
    rows leave the device list with them."""
    phone, laptop = signed_in(ada), signed_in(ada)
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        body = {"password": password, "new_password": NEW_PASSWORD}
        response = laptop.post(PASSWORD_URL, body, content_type="application/json")

    calls = [client.get(CONVERSATIONS_URL).status_code for client in (phone, laptop)]
    assert (response.status_code, calls) == (status, [200 if phone_in else 401, 200])
    assert events(caplog) == [line.format(pk=ada.pk)]
    assert AccountSession.objects.filter(user=ada).count() == (2 if phone_in else 1)
    ada.refresh_from_db()
    assert ada.check_password(NEW_PASSWORD) is not phone_in


@pytest.mark.parametrize(
    ("which", "password", "status", "phone_in", "lines"),
    [
        pytest.param(
            lambda phone, laptop: "others", PASSWORD, 204, False, ["sessions_ended"], id="others"
        ),
        pytest.param(
            lambda phone, laptop: public_id(key(phone)),
            PASSWORD,
            204,
            False,
            ["sessions_ended"],
            id="one",
        ),
        # Signing out is how the caller ends their own.
        pytest.param(
            lambda phone, laptop: public_id(key(laptop)),
            PASSWORD,
            404,
            True,
            [],
            id="the-callers-own",
        ),
        pytest.param(lambda phone, laptop: "0" * 64, PASSWORD, 404, True, [], id="no-such-session"),
        pytest.param(
            lambda phone, laptop: "others",
            "not-the-password",
            400,
            True,
            ["reauth_failed"],
            id="a-wrong-password",
        ),
    ],
)
def test_an_account_ends_its_other_sessions_with_its_password(
    caplog: pytest.LogCaptureFixture,
    ada: User,
    root: User,
    which: Callable[[Client, Client], str],
    password: str,
    status: int,
    phone_in: bool,
    lines: list[str],
) -> None:
    """AC-M3. The device ended is signed out at its next request, a 401; the
    session of another account is not the caller's to end."""
    phone, laptop, other = signed_in(ada), signed_in(ada), signed_in(root)
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        body = {"password": password, "session": which(phone, laptop)}
        response = laptop.post(END_URL, body, content_type="application/json")

    calls = [client.get(CONVERSATIONS_URL).status_code for client in (phone, laptop, other)]
    assert (response.status_code, calls) == (status, [200 if phone_in else 401, 200, 200])
    assert [line.split(" ", 1)[0] for line in events(caplog)] == lines
