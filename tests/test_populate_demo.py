"""`manage.py populate_demo`, run on a small data file of the real one's shape.

Each case sets `DEMO_PASSWORD` itself, to a value or to nothing, so a local
`.env` that sets it changes no result. The database is read back as one
snapshot and compared whole. Passwords are hashed with MD5, as in
tests/test_accounts_api.py, since the command sets one per account.
"""

from __future__ import annotations

import json
import re
from io import StringIO
from typing import TYPE_CHECKING, Any

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client
from pydantic import SecretStr

from apps.accounts.models import User
from apps.catalog.models import (
    CodeSource,
    Course,
    CourseEdition,
    CurriculumEntry,
    DegreeProgramme,
)
from apps.roles.management.commands.populate_demo import DATA, Command
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role
from config.env import env

if TYPE_CHECKING:
    from pathlib import Path

    from pytest_django import Settings

pytestmark = pytest.mark.django_db

PASSWORD = "demo-password"

# PPM in both of B047's curricula, a course B047 shares with B046, and an integrated
# course of B046's own, whose code no single Moodle course holds.
DEMO: dict[str, Any] = {
    "academic_years": ["2024-2025", "2025-2026"],
    "programmes": [
        {"code": "B047", "name": "Ingegneria Informatica", "locale": "it"},
        {"code": "B046", "name": "Ingegneria Elettronica", "locale": "it"},
    ],
    "courses": [
        {
            "code": "B028451",
            "name": "Progettazione e Produzione Multimediale",
            "locale": "it",
            "entries": [
                {
                    "programme": "B047",
                    "curriculum": "TECNICO APPLICATIVO",
                    "year_of_study": 3,
                    "ad_code": "B028451",
                },
                {
                    "programme": "B047",
                    "curriculum": "TECNICO SCIENTIFICO",
                    "year_of_study": 3,
                    "ad_code": "B003712",
                },
            ],
        },
        {
            "code": "B000001",
            "name": "Analisi Matematica I",
            "locale": "it",
            "entries": [
                {"programme": "B047", "curriculum": "", "year_of_study": 1, "ad_code": "B000001"},
                {"programme": "B046", "curriculum": "", "year_of_study": 1, "ad_code": "B000001"},
            ],
        },
        {
            "code": "B000002",
            "name": "Elettronica e Misure C.I.",
            "locale": "it",
            "code_source": "cineca-only",
            "entries": [
                {"programme": "B046", "curriculum": "", "year_of_study": 2, "ad_code": "B000002"},
            ],
        },
    ],
    "accounts": [
        {"username": "demo-admin", "superuser": True},
        {"username": "demo-secretariat", "roles": [{"role": "secretariat", "programme": "B047"}]},
        {
            "username": "demo-teacher",
            "roles": [{"role": "teacher", "edition": "B028451:2025-2026"}],
        },
        {"username": "demo-student"},
    ],
}


@pytest.fixture(autouse=True)
def _fast_password_hashing(settings: Settings) -> None:
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


def run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, password: str | None, demo: dict[str, Any]
) -> str:
    """The command's output, run on `demo` with `DEMO_PASSWORD` set to `password`."""
    monkeypatch.setattr(env, "demo_password", None if password is None else SecretStr(password))
    data = tmp_path / "demo.json"
    data.write_text(json.dumps(demo), encoding="utf-8")
    out = StringIO()
    call_command("populate_demo", data=data, stdout=out)
    return out.getvalue()


def snapshot() -> dict[str, list[Any]]:
    return {
        "programmes": sorted(DegreeProgramme.objects.values_list("code", "name")),
        "courses": sorted(Course.objects.values_list("code", "name", "code_source")),
        "entries": sorted(str(e) for e in CurriculumEntry.objects.select_related("programme")),
        "editions": sorted(
            (str(e), e.is_current) for e in CourseEdition.objects.select_related("course")
        ),
        "roles": sorted(
            str(r) for r in RoleAssignment.objects.select_related("user", "programme", "edition")
        ),
        "accounts": sorted(
            (u.username, u.is_superuser, u.is_staff, u.has_usable_password())
            for u in User.objects.all()
        ),
    }


DEMO_ACCOUNTS = [
    ("demo-admin", True, True, False),
    ("demo-secretariat", False, False, False),
    ("demo-student", False, False, False),
    ("demo-teacher", False, False, False),
]
DEMO_ROLES = [
    "demo-secretariat · secretariat · B047",
    "demo-teacher · teacher · B028451:2025-2026",
]


def test_an_empty_database_gets_the_demo_and_a_second_run_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = run(tmp_path, monkeypatch, None, DEMO)
    once = snapshot()
    second = run(tmp_path, monkeypatch, None, DEMO)

    assert once == {
        "programmes": [("B046", "Ingegneria Elettronica"), ("B047", "Ingegneria Informatica")],
        "courses": [
            ("B000001", "Analisi Matematica I", "moodle"),
            ("B000002", "Elettronica e Misure C.I.", "cineca-only"),
            ("B028451", "Progettazione e Produzione Multimediale", "moodle"),
        ],
        "entries": [
            "B000001 (B046)",
            "B000001 (B047)",
            "B000002 (B046)",
            "B003712 (B047) TECNICO SCIENTIFICO",
            "B028451 (B047) TECNICO APPLICATIVO",
        ],
        # The first year is made current, as a teacher of the second alone
        # would find it (tests/test_catalog_api.py, the first-year teacher).
        "editions": [
            ("B000001:2024-2025", True),
            ("B000001:2025-2026", False),
            ("B000002:2024-2025", True),
            ("B000002:2025-2026", False),
            ("B028451:2024-2025", True),
            ("B028451:2025-2026", False),
        ],
        "roles": DEMO_ROLES,
        "accounts": DEMO_ACCOUNTS,
    }
    assert snapshot() == once
    assert (first.splitlines()[-1], second.splitlines()) == (
        "created 2 degree programmes, 3 courses, 5 curriculum entries, 6 course editions",
        ["created nothing"],
    )


def test_rows_of_its_own_are_kept_and_demo_accounts_made_the_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ppm = Course.objects.create(code="B028451", name="PPM")
    CourseEdition.objects.create(course=ppm, academic_year="2025-2026", is_current=True)
    b047 = DegreeProgramme.objects.create(code="B047", name="Ingegneria Informatica")
    # A demo account holding a role the file does not declare, a demo account the file
    # does not name, and one that is not a demo account.
    newcomer = User.objects.create_user(username="demo-teacher", is_superuser=True)
    RoleAssignment.objects.create(user=newcomer, role=Role.SECRETARIAT, programme=b047)
    retired = User.objects.create_user(username="demo-staff")
    RoleAssignment.objects.create(user=retired, role=Role.SECRETARIAT, programme=b047)
    staff = User.objects.create_user(username="mrossi")
    RoleAssignment.objects.create(user=staff, role=Role.SECRETARIAT, programme=b047)

    out = run(tmp_path, monkeypatch, None, DEMO)
    seen = snapshot()

    assert ("B028451", "PPM", "moodle") in seen["courses"]
    assert [e for e in seen["editions"] if e[0].startswith("B028451")] == [
        ("B028451:2024-2025", False),
        ("B028451:2025-2026", True),
    ]
    assert (seen["roles"], seen["accounts"]) == (
        [*DEMO_ROLES, "mrossi · secretariat · B047"],
        sorted(
            [*DEMO_ACCOUNTS, ("demo-staff", False, False, False), ("mrossi", False, False, False)]
        ),
    )
    assert sorted(line for line in out.splitlines() if " role " in line) == [
        "added role demo-secretariat · secretariat · B047",
        "added role demo-teacher · teacher · B028451:2025-2026",
        "removed role demo-staff · secretariat · B047",
        "removed role demo-teacher · secretariat · B047",
    ]


def test_demo_password_lets_every_demo_account_log_in(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run(tmp_path, monkeypatch, None, DEMO)
    run(tmp_path, monkeypatch, PASSWORD, DEMO)
    signed_in = Client()
    signed_in.login(username="demo-teacher", password=PASSWORD)
    # A run with the same password keeps its hash, so the session stays valid.
    run(tmp_path, monkeypatch, PASSWORD, DEMO)

    assert all(
        Client().login(username=account["username"], password=PASSWORD)
        for account in DEMO["accounts"]
    )
    assert signed_in.get("/api/auth/me").json()["authenticated"] is True


def test_a_demo_account_switched_off_stays_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run(tmp_path, monkeypatch, PASSWORD, DEMO)
    User.objects.filter(username="demo-admin").update(is_active=False)
    run(tmp_path, monkeypatch, PASSWORD, DEMO)

    assert User.objects.get(username="demo-admin").is_active is False


def _with(**changes: Any) -> dict[str, Any]:
    return {**DEMO, **changes}


@pytest.mark.parametrize(
    ("demo", "taken", "refusal"),
    [
        pytest.param(
            _with(
                courses=[
                    *DEMO["courses"],
                    {
                        "code": "B000003",
                        "name": "Fisica I",
                        "locale": "it",
                        "entries": [
                            {
                                "programme": "B046",
                                "curriculum": "",
                                "year_of_study": 1,
                                "ad_code": "B000002",
                            }
                        ],
                    },
                ]
            ),
            None,
            "already used by another course",
            id="an-AD-code-of-two-courses",
        ),
        pytest.param(
            DEMO,
            "before the run",
            "already has a password of its own",
            id="a-demo-account-with-a-password",
        ),
        pytest.param(
            DEMO,
            "during the run",
            "already has a password of its own",
            id="a-demo-account-registered-during-the-run",
        ),
        pytest.param(
            _with(accounts=[*DEMO["accounts"], {"username": "mrossi"}]),
            None,
            "outside demo-",
            id="an-account-outside-demo",
        ),
        pytest.param(
            _with(
                accounts=[
                    {"username": "demo-x", "roles": [{"role": "secretary", "programme": "B047"}]}
                ]
            ),
            None,
            "no role 'secretary'",
            id="a-role-the-registry-does-not-name",
        ),
        pytest.param(
            _with(
                accounts=[
                    {"username": "demo-x", "roles": [{"role": "teacher", "edition": "B028451"}]}
                ]
            ),
            None,
            "no scope",
            id="an-edition-with-no-year",
        ),
    ],
)
def test_a_refused_run_changes_nothing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    demo: dict[str, Any],
    taken: str | None,
    refusal: str,
) -> None:
    # Registration is open: anyone may take a demo name, before the run or while
    # it writes the catalogue.
    if taken == "before the run":
        User.objects.create_user(username="demo-admin", password=PASSWORD)
    empty = snapshot()
    if taken == "during the run":
        catalogue = Command._catalogue

        def racing(self: Command, demo: dict[str, Any]) -> None:
            catalogue(self, demo)
            User.objects.create_user(username="demo-admin", password=PASSWORD)

        monkeypatch.setattr(Command, "_catalogue", racing)

    with pytest.raises(CommandError, match=refusal):
        run(tmp_path, monkeypatch, None, demo)

    assert snapshot() == empty


def test_the_demo_data_file_keeps_the_catalogue_rules() -> None:
    """The shipped file, read without a database: codes, code sources, entries, and one
    course per AD code."""
    demo = json.loads(DATA.read_text(encoding="utf-8"))
    ad_codes: dict[str, set[str]] = {}
    for course in demo["courses"]:
        for entry in course["entries"]:
            ad_codes.setdefault(entry["ad_code"], set()).add(course["code"])
    codes = [c["code"] for c in demo["courses"]] + list(ad_codes)
    sources = {c.get("code_source", CodeSource.MOODLE) for c in demo["courses"]}

    assert [c["code"] for c in demo["courses"] if not c["entries"]] == []
    assert [code for code in codes if not re.fullmatch("[A-Z0-9]+", code)] == []
    assert sources - set(CodeSource.values) == set()
    assert {ad: courses for ad, courses in ad_codes.items() if len(courses) > 1} == {}
    assert all(account["username"].startswith("demo-") for account in demo["accounts"])
