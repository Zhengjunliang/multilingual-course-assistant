"""Links one person hands another, each used once by whoever holds it: a reset link
(apps/accounts/links.py), made by a superuser, and an invitation (apps/roles/invitations.py),
made by whoever may grant a role.

Real requests, as in tests/test_account_sessions.py: what is under test is a
token that travels in a body, the row it opens, the sessions it ends and the
role it grants. The invitations are made in `world()` (tests/test_roles.py),
whose people are signed in without a password.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import threading
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from django.conf import settings
from django.db import connection
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient
from test_account_sessions import age
from test_catalog_api import as_user
from test_error_contract import refused
from test_roles import World, label, world

from apps.accounts.models import ResetLink, User
from apps.catalog.models import CourseEdition, DegreeProgramme
from apps.roles import invitations
from apps.roles.grants import grant
from apps.roles.invitations import accept, invite, revoke_invitation
from apps.roles.models import Invitation, RoleAssignment
from apps.roles.registry import Role

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
INVITATION_URL = "/api/auth/invitation/lookup"
ACCEPT_URL = "/api/auth/invitation/accept"
EVERY_INVITATION_URL = "/api/catalog/invitations"
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


def voided_by_a_password_change(root: User, ada: User) -> str:
    """Its owner has a password they know again."""
    token = make_link(root, ada)
    body = {"password": PASSWORD, "new_password": PASSWORD + "!"}
    assert signed_in(ada).post("/api/auth/password", body, content_type=JSON).status_code == 204
    return token


@pytest.mark.parametrize(
    "token_of",
    [
        pytest.param(used, id="used"),
        pytest.param(expired, id="expired"),
        pytest.param(replaced, id="replaced-by-a-newer-one"),
        pytest.param(unknown, id="unknown"),
        pytest.param(voided_by_a_password_change, id="its-owner-changed-the-password"),
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


def test_the_owner_resetting_from_a_session_of_their_own_is_signed_out_there_too(
    root: User, ada: User
) -> None:
    """A session the request refreshes on its way in (apps/accounts/middleware.py)
    would otherwise be saved on the way out, over the row the reset deleted."""
    own = signed_in(ada)
    age(own, seen=timedelta(minutes=2))
    token = make_link(root, ada)

    reset = own.post(RESET_URL, {"token": token, "new_password": NEW_PASSWORD}, content_type=JSON)

    assert (reset.status_code, signed_in_still(own)) == (204, [False])


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


def a_reset_links_life(root: User, ada: User) -> str:
    token = make_link(root, ada)
    holder = Client()
    holder.post(LOOKUP_URL, {"token": token}, content_type=JSON)
    for password in ("too-short", NEW_PASSWORD, NEW_PASSWORD):
        holder.post(RESET_URL, {"token": token, "new_password": password}, content_type=JSON)
    return token


def an_invitations_life(root: User, ada: User) -> str:
    b047 = DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")
    token = signed_in(root).post(f"/api/catalog/programmes/{b047.code}/invitations").json()["token"]
    holder = Client()
    holder.post(INVITATION_URL, {"token": token}, content_type=JSON)
    # Refused, accepted, then refused as dead to the account it made.
    for password in ("too-short", NEW_PASSWORD):
        body = {"token": token, "username": "grace", "password": password}
        holder.post(ACCEPT_URL, body, content_type=JSON)
    grace = User.objects.get(username="grace")
    holder.post(ACCEPT_URL, {"token": token, "account": grace.pk}, content_type=JSON)
    return token


@pytest.mark.parametrize("life", [a_reset_links_life, an_invitations_life])
def test_no_line_of_the_log_holds_a_token(
    caplog: pytest.LogCaptureFixture,
    root: User,
    ada: User,
    life: Callable[[User, User], str],
) -> None:
    """The token travels in bodies, which nothing logs; every line a link's life
    writes, each refusal's included, is read for it."""
    with caplog.at_level(logging.DEBUG):
        token = life(root, ada)

    lines = [record.getMessage() for record in caplog.records]
    assert any("LINK_EXPIRED" in line for line in lines)
    assert [line for line in lines if token in line] == []


def invitations_of(scope: CourseEdition | DegreeProgramme) -> str:
    if isinstance(scope, CourseEdition):
        return f"/api/catalog/editions/{scope.pk}/invitations"
    return f"/api/catalog/programmes/{scope.code}/invitations"


@pytest.mark.parametrize(
    ("maker", "scope", "status"),
    [
        pytest.param("secretariat", "ppm_old", 201, id="secretariat-to-teach-in-their-programme"),
        pytest.param("root", "b047", 201, id="the-superuser-to-a-secretariat"),
        pytest.param("continuing", "ppm_old", 201, id="a-teacher-to-teach-their-course"),
        # A past year's teachers are not its course's teachers to change.
        pytest.param("continuing", "ppm_past", 403, id="a-teacher-to-teach-a-past-year"),
        pytest.param("secretariat", "b047", 403, id="secretariat-to-their-own-role"),
        pytest.param("other_secretariat", "ppm_old", 404, id="secretariat-outside-their-programme"),
    ],
)
def test_whoever_may_grant_a_role_invites_to_it_and_nobody_else(
    caplog: pytest.LogCaptureFixture, maker: str, scope: str, status: int
) -> None:
    """The token is in the answer and nowhere else, as a reset link's: the table
    keeps its digest, and the log names who invited to what."""
    w = world()
    on: CourseEdition | DegreeProgramme = getattr(w, scope)
    client = as_user(getattr(w, maker))
    caplog.clear()

    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        response = client.post(invitations_of(on), {}, format="json")

    assert response.status_code == status
    if status != 201:
        assert not Invitation.objects.exists()
        assert events(caplog) == []
        return
    body = response.json()
    invitation = Invitation.objects.get()
    assert invitation.token_hash == hashlib.sha256(body["token"].encode()).hexdigest()
    assert (body["id"], body["created_by"]) == (invitation.pk, maker)
    left = (datetime.fromisoformat(body["expires_at"]) - timezone.now()).total_seconds()
    assert left == pytest.approx(72 * 3600, abs=60)
    role = "teacher" if isinstance(on, CourseEdition) else "secretariat"
    assert events(caplog) == [
        f"invitation_created invitation={invitation.pk} role={role!r} on={label(on)!r} "
        f"by={maker!r} ip='127.0.0.1'"
    ]


def test_a_scope_lists_its_invitations_without_their_tokens_and_revokes_them(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The superuser reads every scope's; an invitation is revoked under its own
    scope only, and once."""
    w = world()
    staff = as_user(w.secretariat)
    made = staff.post(invitations_of(w.ppm_old), {}, format="json").json()
    elsewhere, _ = invite(w.root, Role.SECRETARIAT, w.b047, None)

    listed = staff.get(invitations_of(w.ppm_old)).json()
    every = as_user(w.root).get(EVERY_INVITATION_URL).json()

    course = w.ppm_old.course
    assert (made["role"], made["edition"], made["programme"]) == (
        "teacher",
        {
            "id": w.ppm_old.pk,
            "course": {"code": course.code, "name": course.name, "locale": course.locale},
            "academic_year": w.ppm_old.academic_year,
        },
        None,
    )
    assert listed == [{key: value for key, value in made.items() if key != "token"}]
    assert [row["id"] for row in every] == [made["id"], elsewhere.pk]
    assert [row for row in every if "token" in row] == []

    mine = f"{invitations_of(w.ppm_old)}/{made['id']}"
    root = as_user(w.root)
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="apps.accounts.events"):
        revoked, again = staff.delete(mine), staff.delete(mine)
        astray = root.delete(f"{invitations_of(w.ppm_old)}/{elsewhere.pk}")

    assert (revoked.status_code, again.status_code, astray.status_code) == (204, 404, 404)
    assert list(Invitation.objects.values_list("pk", flat=True)) == [elsewhere.pk]
    assert events(caplog) == [
        f"invitation_revoked invitation={made['id']} role='teacher' on={label(w.ppm_old)!r} "
        "by='secretariat' ip='127.0.0.1'"
    ]


def test_the_holder_reads_what_an_invitation_makes_them_and_it_stays() -> None:
    w = world()
    _, teach = invite(w.secretariat, Role.TEACHER, w.ppm_old, None)
    _, run = invite(w.root, Role.SECRETARIAT, w.b047, None)
    holder = APIClient()

    granted = [
        holder.post(INVITATION_URL, {"token": t}, format="json").json() for t in (teach, run)
    ]

    course, b047 = w.ppm_old.course, w.b047
    assert granted == [
        {
            "role": "teacher",
            "edition": {
                "id": w.ppm_old.pk,
                "course": {"code": course.code, "name": course.name, "locale": course.locale},
                "academic_year": w.ppm_old.academic_year,
            },
            "programme": None,
        },
        {
            "role": "secretariat",
            "edition": None,
            "programme": {"code": b047.code, "name": b047.name, "locale": b047.locale},
        },
    ]
    assert Invitation.objects.count() == 2


def to_teach(w: World) -> str:
    """An invitation from B047's secretariat to teach PPM's current edition."""
    return invite(w.secretariat, Role.TEACHER, w.ppm_old, None)[1]


def invitation_used(w: World) -> str:
    token = to_teach(w)
    accept(token, w.student, None)
    return token


def invitation_expired(w: World) -> str:
    token = to_teach(w)
    Invitation.objects.update(expires_at=timezone.now())
    return token


def invitation_revoked(w: World) -> str:
    token = to_teach(w)
    revoke_invitation(w.secretariat, Invitation.objects.get(), None)
    return token


def maker_deactivated(w: World) -> str:
    token = to_teach(w)
    w.secretariat.is_active = False
    w.secretariat.save()
    return token


def maker_no_longer_granting(w: World) -> str:
    token = to_teach(w)
    RoleAssignment.objects.filter(user=w.secretariat).delete()
    return token


def made_for_a_year_since_past(w: World) -> str:
    """A teacher's invitation to the current year, which the next one's start makes past."""
    token = invite(w.continuing, Role.TEACHER, w.ppm_old, None)[1]
    w.ppm_new.teaching_starts = timezone.localdate()
    w.ppm_new.save()
    return token


def invitation_unknown(w: World) -> str:
    to_teach(w)
    return "a-token-no-invitation-was-made-with"


@pytest.mark.parametrize(
    "token_of",
    [
        pytest.param(invitation_used, id="used"),
        pytest.param(invitation_expired, id="expired"),
        pytest.param(invitation_revoked, id="revoked"),
        pytest.param(maker_deactivated, id="its-maker-deactivated"),
        pytest.param(maker_no_longer_granting, id="its-maker-no-longer-granting-the-role"),
        pytest.param(made_for_a_year_since_past, id="a-teacher-s-for-a-year-since-past"),
        pytest.param(invitation_unknown, id="unknown"),
    ],
)
@pytest.mark.parametrize(
    ("url", "body"),
    [
        pytest.param(INVITATION_URL, {}, id="lookup"),
        pytest.param(ACCEPT_URL, {"username": "grace", "password": NEW_PASSWORD}, id="accept"),
    ],
)
def test_an_invitation_that_does_not_work_is_one_answer_whatever_the_reason(
    token_of: Callable[[World], str], url: str, body: dict[str, str]
) -> None:
    """Its maker is asked again whether they may grant the role: the grant is theirs."""
    w = world()
    token = token_of(w)

    response = APIClient().post(url, {"token": token, **body}, format="json")

    assert (response.status_code, refused(response)) == (404, ("LINK_EXPIRED", {}))
    assert not User.objects.filter(username="grace").exists()


def test_accepting_makes_an_account_staff_of_the_scope_and_signs_it_in(
    caplog: pytest.LogCaptureFixture, django_capture_on_commit_callbacks
) -> None:
    """The holder chooses the username and the password; the grant is the maker's."""
    w = world()
    token = to_teach(w)
    invitation = Invitation.objects.get().pk
    holder = APIClient()
    body = {"token": token, "username": "grace", "password": NEW_PASSWORD, "locale": "en"}
    caplog.clear()

    # The grant's line is written on commit, as tests/test_catalog_api.py explains.
    with (
        caplog.at_level(logging.INFO),
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = holder.post(ACCEPT_URL, body, format="json")

    grace = User.objects.get(username="grace")
    assert response.status_code == 201
    assert response.json() == {
        "authenticated": True,
        "user": {
            "id": grace.pk,
            "username": "grace",
            "locale": "en",
            "is_superuser": False,
            "roles": [{"role": "teacher", "edition": w.ppm_old.pk}],
            "programme": None,
            "year_of_study": None,
        },
    }
    assert holder.get(ME_URL).json()["authenticated"]
    assert grace.check_password(NEW_PASSWORD)
    assert not Invitation.objects.exists()
    on, who = label(w.ppm_old), f"user={grace.pk} username='grace'"
    assert events(caplog) == [
        f"register {who} ip='127.0.0.1'",
        f"invitation_accepted {who} invitation={invitation} role='teacher' on={on!r} "
        "by='secretariat' ip='127.0.0.1'",
        f"login {who} ip='127.0.0.1'",
    ]
    grants = [r.getMessage() for r in caplog.records if r.name == "apps.roles.grants"]
    assert grants == [f"granted teacher on {on} to grace by secretariat"]


@pytest.mark.parametrize(
    ("who", "status", "code"),
    [
        pytest.param("student", 200, None, id="an-account-with-no-role-there"),
        # The link stays for whoever it was meant for.
        pytest.param("continuing", 409, "ROLE_ALREADY_HELD", id="an-account-holding-it-already"),
    ],
)
def test_an_account_signed_in_accepts_as_itself(who: str, status: int, code: str | None) -> None:
    """Named by its id. The session that gains the role is given a new key,
    and stays signed in."""
    w = world()
    token = to_teach(w)
    user: User = getattr(w, who)
    client = as_user(user)
    key = client.cookies[settings.SESSION_COOKIE_NAME].value

    response = client.post(ACCEPT_URL, {"token": token, "account": user.pk}, format="json")

    assert response.status_code == status
    rotated = client.cookies[settings.SESSION_COOKIE_NAME].value != key
    assert (rotated, client.get(ME_URL).json()["authenticated"]) == (code is None, True)
    assert RoleAssignment.objects.filter(user=user, role="teacher", edition=w.ppm_old).exists()
    if code is not None:
        assert refused(response) == (code, {})
        assert Invitation.objects.exists()
        return
    assert {"role": "teacher", "edition": w.ppm_old.pk} in response.json()["user"]["roles"]
    assert not Invitation.objects.exists()


@pytest.mark.parametrize(
    "signed_in_as",
    [
        pytest.param(None, id="nobody"),
        pytest.param("secretariat", id="another-account"),
    ],
)
def test_an_account_named_but_not_signed_in_is_refused_as_signed_out(
    signed_in_as: str | None,
) -> None:
    """A page that took itself for signed in as the student, its session ended
    or another window having signed in as someone else meanwhile: told so, it
    offers to make an account instead, nobody gains the role, the link stays."""
    w = world()
    token = to_teach(w)
    client = as_user(None if signed_in_as is None else getattr(w, signed_in_as))
    teachers = RoleAssignment.objects.filter(role="teacher", edition=w.ppm_old).count()

    response = client.post(ACCEPT_URL, {"token": token, "account": w.student.pk}, format="json")

    assert (response.status_code, refused(response)) == (401, ("UNAUTHENTICATED", {}))
    assert RoleAssignment.objects.filter(role="teacher", edition=w.ppm_old).count() == teachers
    assert Invitation.objects.exists()


@pytest.mark.parametrize("body", ["5", "null", "[{}]"])
def test_a_body_that_is_not_an_object_is_refused_as_one(body: str) -> None:
    w = world()
    to_teach(w)

    response = Client().post(ACCEPT_URL, body, content_type=JSON)

    assert (response.status_code, refused(response)[0]) == (400, "INVALID_ARGUMENT")


def test_an_account_named_while_signed_in_is_made_and_signed_in_as_registering_does() -> None:
    """A page that took itself for signed out, another window having signed in
    meanwhile: the account typed is the one that accepts."""
    w = world()
    token = to_teach(w)
    client = as_user(w.student)
    body = {"token": token, "username": "grace", "password": NEW_PASSWORD}

    response = client.post(ACCEPT_URL, body, format="json")

    assert (response.status_code, client.get(ME_URL).json()["user"]["username"]) == (201, "grace")
    teaching = RoleAssignment.objects.filter(role="teacher", edition=w.ppm_old)
    assert (
        teaching.filter(user__username="grace").exists(),
        teaching.filter(user=w.student).exists(),
    ) == (True, False)


@pytest.mark.parametrize(
    ("account", "fields"),
    [
        pytest.param(
            {"username": "student", "password": NEW_PASSWORD},
            {"username": ["ALREADY_EXISTS"]},
            id="a-username-taken",
        ),
        pytest.param(
            {"username": "grace", "password": "too-short"},
            {"password": ["TOO_SHORT"]},
            id="a-password-refused",
        ),
    ],
)
def test_an_account_the_rules_refuse_leaves_the_invitation_working(
    account: dict[str, str], fields: dict[str, list[str]]
) -> None:
    w = world()
    token = to_teach(w)
    holder = APIClient()

    refusal = holder.post(ACCEPT_URL, {"token": token, **account}, format="json")

    assert refused(refusal) == ("INVALID_ARGUMENT", fields)
    body = {"token": token, "username": "grace", "password": NEW_PASSWORD}
    assert holder.post(ACCEPT_URL, body, format="json").status_code == 201


@pytest.mark.django_db(transaction=True)
def test_two_holders_accepting_at_once_are_granted_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each in a thread, on a connection, of its own. At the grant each waits half
    a second for the other, which only the invitation's lock keeps from getting
    there: without it, both would be past the lookup and both granted."""
    w = world()
    token = to_teach(w)
    meet = threading.Barrier(2, timeout=0.5)

    def grant_once_both_arrive(*args: object) -> RoleAssignment:
        with contextlib.suppress(threading.BrokenBarrierError):
            meet.wait()
        return grant(*args)  # pyright: ignore[reportArgumentType]

    monkeypatch.setattr(invitations, "grant", grant_once_both_arrive)
    statuses: list[int] = []

    def accept_as(username: str) -> None:
        try:
            body = {"token": token, "username": username, "password": NEW_PASSWORD}
            statuses.append(APIClient().post(ACCEPT_URL, body, format="json").status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=accept_as, args=(name,)) for name in ("grace", "alan")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(statuses) == [201, 404]
    assert User.objects.filter(username__in=("grace", "alan")).count() == 1
    assert RoleAssignment.objects.filter(user__username__in=("grace", "alan")).count() == 1
