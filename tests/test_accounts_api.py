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

from typing import TYPE_CHECKING

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.qa import engine as engine_module
from rag.chunk import normalize_locale

if TYPE_CHECKING:
    from pytest_django import Settings

pytestmark = pytest.mark.django_db

ME_URL = "/api/auth/me"
LOGIN_URL = "/api/auth/login"
LOGOUT_URL = "/api/auth/logout"
REGISTER_URL = "/api/auth/register"
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


def test_me_names_whoever_is_logged_in(student: User) -> None:
    body = logged_in().get(ME_URL).json()

    assert body["authenticated"] is True
    assert body["user"]["username"] == USERNAME


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


def test_a_new_account_defaults_to_the_project_locale() -> None:
    APIClient().post(REGISTER_URL, {"username": "ada", "password": PASSWORD}, format="json")

    assert User.objects.get(username="ada").locale == "it"


def test_registering_with_a_chosen_locale_keeps_it() -> None:
    """The domain is multilingual from the first request a person makes, not
    from the moment they find a settings page."""
    APIClient().post(
        REGISTER_URL,
        {"username": "ada", "password": PASSWORD, "locale": "zh-hans"},
        format="json",
    )

    assert User.objects.get(username="ada").locale == "zh-hans"


def test_a_password_django_rejects_is_refused(student: User) -> None:
    """`AUTH_PASSWORD_VALIDATORS` is configured but reaches nothing on its own —
    something has to call it, and the two frameworks' `ValidationError` classes
    are different, so the call is a bridge that can be dropped."""
    response = APIClient().post(
        REGISTER_URL, {"username": "ada", "password": "password"}, format="json"
    )

    assert response.status_code == 400
    assert "password" in response.json()
    assert not User.objects.filter(username="ada").exists()


def test_a_username_already_taken_is_refused(student: User) -> None:
    """Through the model's own uniqueness rule. Hand-written, this reaches the
    database as an IntegrityError and the caller as a 500."""
    response = APIClient().post(
        REGISTER_URL, {"username": USERNAME, "password": PASSWORD}, format="json"
    )

    assert response.status_code == 400
    assert "username" in response.json()


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
    assert wrong_password.json() == no_such_user.json()


def test_logging_out_ends_the_session(student: User) -> None:
    client = logged_in()

    assert client.post(LOGOUT_URL).status_code == 204
    assert client.get(ME_URL).json()["authenticated"] is False


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
    assert "locale" in response.json()


def test_the_username_cannot_be_changed_through_me(student: User) -> None:
    """The endpoint exists to switch languages. A writable username here would
    be an account takeover surface opened by accident."""
    response = logged_in().patch(ME_URL, {"username": "somebody-else"}, format="json")
    student.refresh_from_db()

    assert response.status_code == 200
    assert student.username == USERNAME


def test_changing_a_language_needs_a_login() -> None:
    assert APIClient().patch(ME_URL, {"locale": "en"}, format="json").status_code == 403


def test_the_django_locale_maps_onto_the_one_rag_speaks() -> None:
    """Two namespaces, on purpose, with one bridge between them.

    Django names the language `zh-hans` because that is what its own catalogues
    and `settings.LANGUAGES` use; `rag/` names it `zh` because a payload filter
    matches a BCP-47 primary subtag. The bridge runs one way only — an account's
    preference becomes a retrieval locale, never the reverse.
    """
    assert normalize_locale("zh-hans") == "zh"
    assert normalize_locale("it") == "it"


def test_a_logged_in_question_without_the_csrf_token_is_refused(student: User) -> None:
    """The debt apps/qa/views.py used to record, from the other side.

    A session cookie rides along with every request the browser makes, including
    one a different site caused. The token is what separates those, and it is
    enforced during authentication — before the handler, so a refused request
    costs no GPU at all.
    """
    client = APIClient(enforce_csrf_checks=True)
    assert client.login(username=USERNAME, password=PASSWORD)

    response = client.post(ASK_URL, {"question": "What is an ORM?"}, format="json")

    assert response.status_code == 403
    assert engine_module._HOLDER.engine is None


def test_the_csrf_token_from_the_cookie_gets_a_request_through(student: User) -> None:
    """The other half: the SPA's actual recipe has to work.

    It stops at the serializer on purpose — a blank question is refused at
    validation, which is already past authentication and permission and is as
    far as this test can go without loading a model into a GPU.
    """
    client = APIClient(enforce_csrf_checks=True)
    assert client.login(username=USERNAME, password=PASSWORD)
    client.get(ME_URL)  # what issues the cookie
    token = client.cookies["csrftoken"].value

    response = client.post(ASK_URL, {"question": "   "}, format="json", HTTP_X_CSRFTOKEN=token)

    assert response.status_code == 400
    assert "question" in response.json()


def test_the_auth_bucket_refuses_a_sixth_attempt_in_a_minute() -> None:
    """A password guess costs the server nothing, which is the problem: without
    a limit the only bound on guessing is the attacker's bandwidth."""
    codes = [
        APIClient()
        .post(LOGIN_URL, {"username": "nobody", "password": "guess"}, format="json")
        .status_code
        for _ in range(6)
    ]

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
