"""The account endpoints, and the door they close in front of `/api/ask`.

The opposite trade from tests/test_qa_api.py, and deliberately so. That file
forces authentication to stay off the database; this one performs real logins,
because what is under test *is* the session — a cookie, the CSRF token that
travels with it, and the throttle bucket that counts attempts at guessing a
password. Forced authentication skips every one of those.

Password hashing is swapped for a cheap algorithm below. Django's default is
slow by design, and a file that logs in a dozen times would spend most of its
runtime proving that PBKDF2 is expensive.
"""

from __future__ import annotations

import logging
import runpy
from typing import TYPE_CHECKING

import pytest
from rest_framework.test import APIClient
from test_error_contract import refused

import config.env
import config.settings
from apps.accounts.models import User
from apps.catalog.models import Course, CourseEdition, DegreeProgramme
from apps.qa import engine as engine_module
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role
from config.request_id import RequestIdFilter
from rag.chunk import normalize_locale

if TYPE_CHECKING:
    from collections.abc import Callable

    from pytest_django import Settings
    from rest_framework.response import Response

pytestmark = pytest.mark.django_db

ME_URL = "/api/auth/me"
LOGIN_URL = "/api/auth/login"
LOGOUT_URL = "/api/auth/logout"
REGISTER_URL = "/api/auth/register"
PASSWORD_URL = "/api/auth/password"
SESSIONS_END_URL = "/api/auth/sessions/end"
ASK_URL = "/api/ask"

USERNAME = "student"
PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _fast_password_hashing(settings: Settings) -> None:
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture
def student() -> User:
    return User.objects.create_user(username=USERNAME, password=PASSWORD)


def logged_in() -> APIClient:
    client = APIClient()
    assert client.login(username=USERNAME, password=PASSWORD)
    return client


def test_me_answers_a_stranger_with_two_hundred() -> None:
    """Not a 403, and that is the whole design of this endpoint.

    With only `SessionAuthentication` configured DRF refuses an unauthenticated
    request with 403 rather than 401 — and a rejected CSRF token is a 403 too.
    Answering "nobody is logged in" as an ordinary result leaves the SPA one
    meaning per code instead of two per one.
    """
    response = APIClient().get(ME_URL)

    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "user": None}


def test_me_issues_the_csrf_cookie() -> None:
    """The only place the token is handed out, and it has to be.

    `ensure_csrf_cookie` normally rides on a rendered template; in development
    the page is served by Vite and never passes through Django, so a template
    would issue nothing. The SPA calls this first for exactly this reason.
    """
    response = APIClient().get(ME_URL)

    assert "csrftoken" in response.cookies


def test_the_deployed_cookies_are_ones_a_browser_takes_under_their_prefix(
    student: User, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Under `__Host-`, a cookie that is not Secure, on Path=/ and without a Domain is dropped.

    Dropped by the browser without a word: nobody could sign in, and nothing
    on the server would say why. The cookie settings are read from
    config/settings.py run again as deployed, behind TLS with DEBUG off, the
    block this test is about. The deletion counts too: one that is not Secure
    is ignored, and signing out would leave the cookie behind.
    """
    deployed = config.env.env.model_copy(update={"django_debug": False, "django_behind_tls": True})
    monkeypatch.setattr(config.env, "env", deployed)
    for name, value in runpy.run_path(config.settings.__file__).items():
        if name.startswith(("SESSION_COOKIE_", "CSRF_COOKIE_")):
            setattr(settings, name, value)
    client = APIClient()
    login = {"username": USERNAME, "password": PASSWORD}

    issued = [
        client.get(ME_URL).cookies[settings.CSRF_COOKIE_NAME],
        client.post(LOGIN_URL, login, format="json").cookies[settings.SESSION_COOKIE_NAME],
        client.post(LOGOUT_URL).cookies[settings.SESSION_COOKIE_NAME],
    ]

    assert [
        (cookie.key, cookie["secure"], cookie["path"], cookie["domain"]) for cookie in issued
    ] == [
        ("__Host-csrftoken", True, "/", ""),
        ("__Host-sessionid", True, "/", ""),
        ("__Host-sessionid", True, "/", ""),
    ]


def test_me_names_whoever_is_logged_in(student: User) -> None:
    body = logged_in().get(ME_URL).json()

    assert body["authenticated"] is True
    assert body["user"]["username"] == USERNAME


def test_me_names_the_scopes_a_user_holds_a_role_in(student: User) -> None:
    """Where, not what: each scope by the key its URL takes, in a fixed order."""
    programme = DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")
    course = Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")
    edition = CourseEdition.objects.create(course=course, academic_year="2025-2026")
    RoleAssignment.objects.create(user=student, role=Role.SECRETARIAT, programme=programme)
    RoleAssignment.objects.create(user=student, role=Role.TEACHER, edition=edition)

    user = logged_in().get(ME_URL).json()["user"]

    assert user["is_superuser"] is False
    assert user["roles"] == [
        {"role": "secretariat", "programme": "B047"},
        {"role": "teacher", "edition": edition.pk},
    ]


def test_me_marks_the_superuser() -> None:
    User.objects.create_superuser(username=USERNAME, password=PASSWORD)

    user = logged_in().get(ME_URL).json()["user"]

    assert (user["is_superuser"], user["roles"]) == (True, [])


def test_registering_creates_an_account_and_signs_it_in() -> None:
    """One form, not two: the alternative is asking for the same two fields
    again on a login page immediately afterwards."""
    client = APIClient()
    response = client.post(REGISTER_URL, {"username": "ada", "password": PASSWORD}, format="json")

    assert response.status_code == 201
    assert User.objects.filter(username="ada").exists()
    assert client.get(ME_URL).json()["authenticated"] is True


def test_a_registered_password_is_stored_hashed() -> None:
    """`create_user` rather than `create` is what does this, and the failure it
    prevents is silent in both directions — plaintext in the database, and every
    later login refused."""
    APIClient().post(REGISTER_URL, {"username": "ada", "password": PASSWORD}, format="json")
    ada = User.objects.get(username="ada")

    assert ada.password != PASSWORD
    assert ada.check_password(PASSWORD)


@pytest.mark.parametrize(
    ("chosen", "kept"),
    [
        pytest.param({}, "it", id="none-the-projects"),
        pytest.param({"locale": "zh-hans"}, "zh-hans"),
    ],
)
def test_registering_keeps_the_chosen_locale(chosen: dict[str, str], kept: str) -> None:
    """The domain is multilingual from the first request a person makes, not
    from the moment they find a settings page."""
    APIClient().post(
        REGISTER_URL, {"username": "ada", "password": PASSWORD, **chosen}, format="json"
    )

    assert User.objects.get(username="ada").locale == kept


# Long enough for every rule but the one a row breaks, and close to no username.
LEAKED = "a-made-up-password-only-the-fake-range-holds"
RULES_USERNAME = "analytical-engine"


def register_with(password: str) -> Response:
    body = {"username": RULES_USERNAME, "password": password}
    return APIClient().post(REGISTER_URL, body, format="json")


def change_to(password: str) -> Response:
    user = User.objects.create_user(username=RULES_USERNAME, password=PASSWORD)
    client = APIClient()
    client.force_login(user)
    return client.post(
        PASSWORD_URL, {"password": PASSWORD, "new_password": password}, format="json"
    )


@pytest.mark.parametrize(
    ("set_password", "field"),
    [
        pytest.param(register_with, "password", id="register"),
        pytest.param(change_to, "new_password", id="change"),
    ],
)
@pytest.mark.parametrize(
    ("password", "refusals"),
    [
        # No rule on what a password is made of (config/settings.py).
        pytest.param("804917365208431", [], id="fifteen-digits"),
        pytest.param("k" * 64, [], id="sixty-four-characters"),
        pytest.param("k7#q2-mVz9Lp4w!", [], id="fifteen-characters"),
        pytest.param(
            "k7#q2-mVz9Lp4w", [("TOO_SHORT", {"min_length": 15})], id="fourteen-characters"
        ),
        pytest.param("k" * 129, [("TOO_LONG", {"max_length": 128})], id="129-characters"),
        pytest.param("1234567890qwertyuiop", [("TOO_COMMON", {})], id="common"),
        pytest.param(LEAKED, [("BREACHED", {})], id="breached"),
        pytest.param("analytical-engine-1843", [("TOO_SIMILAR", {})], id="like-the-username"),
    ],
)
def test_a_new_password_is_held_to_the_rules(
    leaked_passwords: set[str],
    set_password: Callable[[str], Response],
    field: str,
    password: str,
    refusals: list[tuple[str, dict[str, int]]],
) -> None:
    """`AUTH_PASSWORD_VALIDATORS` is configured but reaches nothing on its own —
    something has to call it, on every path that sets a password, and the two
    frameworks' `ValidationError` classes are different, so the call is a
    bridge that can be dropped. Each rule broken is a reason of its own, with
    the bound it names, which the page words."""
    leaked_passwords.add(LEAKED)
    response = set_password(password)

    fields = response.data["error"]["fields"] if response.status_code == 400 else []
    seen = [(each["field"], each["reason"], each.get("data", {})) for each in fields]
    assert seen == [(field, reason, data) for reason, data in refusals]
    account = User.objects.filter(username=RULES_USERNAME).first()
    assert (account is not None and account.check_password(password)) == (not refusals)


def test_a_username_already_taken_is_refused(student: User) -> None:
    """Through the model's own uniqueness rule. Hand-written, this reaches the
    database as an IntegrityError and the caller as a 500."""
    response = APIClient().post(
        REGISTER_URL, {"username": USERNAME, "password": PASSWORD}, format="json"
    )

    assert response.status_code == 400
    assert refused(response) == ("INVALID_ARGUMENT", {"username": ["ALREADY_EXISTS"]})


def test_logging_in_starts_a_session(student: User) -> None:
    client = APIClient()
    response = client.post(LOGIN_URL, {"username": USERNAME, "password": PASSWORD}, format="json")

    assert response.status_code == 200
    assert response.json()["user"]["username"] == USERNAME
    assert client.get(ME_URL).json()["authenticated"] is True


def test_wrong_credentials_do_not_reveal_whether_the_account_exists(student: User) -> None:
    """Two different mistakes, one answer. A message that distinguished them
    would be an account-enumeration oracle offered to anyone with a word list,
    and the caller cannot act on the difference anyway."""
    wrong_password = APIClient().post(
        LOGIN_URL, {"username": USERNAME, "password": "not-the-password"}, format="json"
    )
    no_such_user = APIClient().post(
        LOGIN_URL, {"username": "nobody", "password": PASSWORD}, format="json"
    )

    assert wrong_password.status_code == no_such_user.status_code == 400
    bodies = [response.json()["error"] for response in (wrong_password, no_such_user)]
    for body in bodies:
        del body["request_id"]
    assert bodies[0] == bodies[1]
    assert refused(wrong_password) == ("WRONG_CREDENTIALS", {})


def test_logging_out_ends_the_session(student: User) -> None:
    client = logged_in()

    assert client.post(LOGOUT_URL).status_code == 204
    assert client.get(ME_URL).json()["authenticated"] is False


WRONG_PASSWORD = "not-the-password"
CREDENTIALS = {"username": USERNAME, "password": PASSWORD}


@pytest.mark.parametrize(
    ("signed_in", "url", "body", "data_format", "lines"),
    [
        pytest.param(False, LOGIN_URL, CREDENTIALS, "json", [("login", USERNAME)], id="login"),
        pytest.param(True, LOGOUT_URL, None, "json", [("logout", USERNAME)], id="logout"),
        pytest.param(
            False,
            LOGIN_URL,
            {"username": USERNAME, "password": WRONG_PASSWORD},
            "json",
            [("login_failed", USERNAME)],
            id="wrong-password",
        ),
        pytest.param(
            False,
            REGISTER_URL,
            {"username": "ada", "password": PASSWORD},
            "json",
            [("register", "ada"), ("login", "ada")],
            id="register",
        ),
        # The admin's own form and views, which pass through no view of this app.
        pytest.param(
            False,
            "/admin/login/",
            CREDENTIALS,
            "multipart",
            [("login", USERNAME)],
            id="admin-login",
        ),
        pytest.param(
            False,
            "/admin/login/",
            {"username": USERNAME, "password": WRONG_PASSWORD},
            "multipart",
            [("login_failed", USERNAME)],
            id="admin-wrong-password",
        ),
        pytest.param(
            True, "/admin/logout/", None, "multipart", [("logout", USERNAME)], id="admin-logout"
        ),
    ],
)
def test_each_sign_in_and_out_leaves_one_line_naming_who_and_from_where(
    caplog: pytest.LogCaptureFixture,
    signed_in: bool,
    url: str,
    body: dict[str, str] | None,
    data_format: str,
    lines: list[tuple[str, str]],
) -> None:
    """#13: the line an incident is traced by, from whichever door was used.
    A superuser, the one account the admin lets in (config/admin.py)."""
    User.objects.create_superuser(username=USERNAME, password=PASSWORD)
    client = logged_in() if signed_in else APIClient()
    caplog.clear()
    caplog.handler.addFilter(RequestIdFilter())

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        response = client.post(url, body, format=data_format)

    records = [record for record in caplog.records if record.name == "apps.accounts.events"]
    seen = [
        (record.getMessage().split(" ", 1)[0], getattr(record, "request_id", None))
        for record in records
    ]
    assert seen == [(event, response["X-Request-ID"]) for event, _ in lines]
    for record, (_, username) in zip(records, lines, strict=True):
        assert f"username={username!r}" in record.getMessage()
        assert "ip='127.0.0.1'" in record.getMessage()
    # The password, right or wrong, is in no line.
    assert PASSWORD not in caplog.text
    assert WRONG_PASSWORD not in caplog.text


def test_a_student_can_change_the_interface_language(student: User) -> None:
    response = logged_in().patch(ME_URL, {"locale": "zh-hans"}, format="json")
    student.refresh_from_db()

    assert response.status_code == 200
    assert student.locale == "zh-hans"


def test_a_language_the_project_does_not_serve_is_refused(student: User) -> None:
    """`choices` on the model is only enforced through validation, and a
    serializer is one of the places that enforcement can go missing."""
    response = logged_in().patch(ME_URL, {"locale": "xx"}, format="json")

    assert response.status_code == 400
    assert refused(response) == ("INVALID_ARGUMENT", {"locale": ["INVALID"]})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("username", "somebody-else"),
        ("is_superuser", True),
        ("is_staff", True),
        ("roles", [{"role": "secretariat", "programme": "B047"}]),
    ],
    ids=["username", "is_superuser", "is_staff", "roles"],
)
def test_only_the_language_can_be_changed_through_me(
    student: User, field: str, value: object
) -> None:
    """The endpoint exists to switch languages. Any other writable field here
    would be an account takeover or a privilege opened by accident."""
    response = logged_in().patch(ME_URL, {field: value}, format="json")
    student.refresh_from_db()

    assert response.status_code == 200
    assert response.json()["user"] == {
        "id": student.pk,
        "username": USERNAME,
        "locale": student.locale,
        "is_superuser": False,
        "roles": [],
    }
    assert (student.username, student.is_superuser, student.is_staff) == (USERNAME, False, False)
    assert not RoleAssignment.objects.exists()


def test_the_django_locale_maps_onto_the_one_rag_speaks() -> None:
    """Two namespaces, on purpose, with one bridge between them.

    Django names the language `zh-hans` because that is what its own catalogues
    and `settings.LANGUAGES` use; `rag/` names it `zh` because a payload filter
    matches a BCP-47 primary subtag. The bridge runs one way only — an account's
    preference becomes a retrieval locale, never the reverse.
    """
    assert normalize_locale("zh-hans") == "zh"
    assert normalize_locale("it") == "it"


@pytest.mark.parametrize("logged_in", [True, False], ids=["logged-in", "anonymous"])
def test_a_question_without_the_csrf_token_is_refused(
    student: User, logged_in: bool, caplog: pytest.LogCaptureFixture
) -> None:
    """A cookie rides along with every request the browser makes, including one
    a different site caused. The token is what separates those, and it is
    enforced before the handler, so a refused request costs no GPU at all.

    Logged in, the session authentication checks it while authenticating.
    Anonymous, there is no session for that class to check, and the view's
    permission class does it instead (apps/accounts/permissions.py): without it
    any site could ask from a visitor's browser, on the visitor's rate limit.
    Either way the code is its own, not `PERMISSION_DENIED`: what the reader
    needs is a reload, and Django's reason is in the log.
    """
    client = APIClient(enforce_csrf_checks=True)
    if logged_in:
        assert client.login(username=USERNAME, password=PASSWORD)
    # Each in the shape the SPA sends: an anonymous question without its
    # history is refused for that alone (apps/qa/serializers.py), which would
    # pass this test with no CSRF check at all.
    body = {"question": "What is an ORM?"} if logged_in else {"question": "?", "history": []}

    with caplog.at_level(logging.INFO, logger="apps.accounts.authentication"):
        response = client.post(ASK_URL, body, format="json")

    assert (response.status_code, refused(response)) == (403, ("CSRF_FAILED", {}))
    assert engine_module._HOLDER.engine is None
    assert "CSRF check failed: CSRF cookie not set." in caplog.messages


@pytest.mark.parametrize("logged_in", [True, False], ids=["logged-in", "anonymous"])
def test_the_csrf_token_from_the_cookie_gets_a_request_through(
    student: User, logged_in: bool
) -> None:
    """The other half: the SPA's actual recipe has to work.

    It stops at the serializer on purpose — a blank question is refused at
    validation, which is already past authentication and permission and is as
    far as this test can go without loading a model into a GPU.
    """
    client = APIClient(enforce_csrf_checks=True)
    if logged_in:
        assert client.login(username=USERNAME, password=PASSWORD)
    client.get(ME_URL)  # what issues the cookie
    token = client.cookies["csrftoken"].value

    response = client.post(ASK_URL, {"question": "   "}, format="json", HTTP_X_CSRFTOKEN=token)

    assert response.status_code == 400
    assert refused(response) == ("INVALID_ARGUMENT", {"question": ["REQUIRED"]})


SIGN_INS = [
    pytest.param(LOGIN_URL, USERNAME, id="login"),
    pytest.param(REGISTER_URL, "ada", id="register"),
]


@pytest.mark.parametrize(("url", "username"), SIGN_INS)
def test_signing_in_without_the_csrf_token_is_refused(
    student: User, url: str, username: str
) -> None:
    """Login CSRF: a form on another site could otherwise sign a visitor's
    browser into an account the attacker holds, and file every question asked
    after it where the attacker reads it. Nobody is logged in yet, so DRF checks
    no token here, and these views ask for it themselves
    (apps/accounts/permissions.py)."""
    client = APIClient(enforce_csrf_checks=True)

    response = client.post(url, {"username": username, "password": PASSWORD}, format="json")

    assert (response.status_code, refused(response)) == (403, ("CSRF_FAILED", {}))
    assert "sessionid" not in response.cookies


@pytest.mark.parametrize(("url", "username"), SIGN_INS)
def test_signing_in_with_the_csrf_token_from_the_cookie_works(
    student: User, url: str, username: str
) -> None:
    """The SPA's recipe, as for a question: read the cookie `me` issues, send it back."""
    client = APIClient(enforce_csrf_checks=True)
    client.get(ME_URL)
    token = client.cookies["csrftoken"].value

    response = client.post(
        url, {"username": username, "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token
    )

    assert response.status_code in (200, 201)
    assert response.json()["authenticated"] is True


@pytest.mark.parametrize(
    ("signed_in", "url", "body"),
    [
        pytest.param(False, LOGIN_URL, {"username": "nobody", "password": "guess"}, id="login"),
        # A password confirmed before a change is guessed as easily, counted
        # per account (apps/accounts/reauth.py).
        pytest.param(
            True,
            PASSWORD_URL,
            {"password": "guess", "new_password": "lamp-orbit-quietly-87"},
            id="change-password",
        ),
        pytest.param(
            True, SESSIONS_END_URL, {"password": "guess", "session": "others"}, id="end-sessions"
        ),
    ],
)
def test_the_auth_bucket_refuses_a_sixth_attempt_in_a_minute(
    student: User, signed_in: bool, url: str, body: dict[str, str]
) -> None:
    """A password guess costs the server nothing, which is the problem: without
    a limit the only bound on guessing is the attacker's bandwidth."""
    client = logged_in() if signed_in else APIClient()
    codes = [client.post(url, body, format="json").status_code for _ in range(6)]

    assert codes[:5] == [400] * 5
    assert codes[5] == 429


def test_registering_and_logging_in_share_one_bucket() -> None:
    """Both are the same abuse surface reached by the same stranger, so a limit
    on one that the other resets would be no limit at all."""
    for _ in range(5):
        APIClient().post(LOGIN_URL, {"username": "nobody", "password": "guess"}, format="json")

    response = APIClient().post(
        REGISTER_URL, {"username": "ada", "password": PASSWORD}, format="json"
    )

    assert response.status_code == 429
    assert not User.objects.filter(username="ada").exists()


def test_a_forwarded_header_cannot_buy_a_fresh_auth_bucket() -> None:
    """DRF's default is to take the throttle identity from a client-supplied
    X-Forwarded-For, which would make the limit above a suggestion: one header
    per request and every request is a new client. Nothing proxies this service,
    so the identity has to stay REMOTE_ADDR.

    This is where that setting finally carries weight. `ScopedRateThrottle`
    bills an authenticated caller by primary key, so only the endpoints reachable
    without an account — these — are billed by address at all.
    """
    codes = [
        APIClient()
        .post(
            LOGIN_URL,
            {"username": "nobody", "password": "guess"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.0.0.{attempt}",
        )
        .status_code
        for attempt in range(6)
    ]

    assert codes[5] == 429
