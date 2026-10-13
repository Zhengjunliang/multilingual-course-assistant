"""`manage.py populate_demo`, run on a small data file of the real one's shape.

Each case sets `DEMO_PASSWORD` itself, to a value or to nothing, so a local
`.env` that sets it changes no result. The database is read back as one
snapshot and compared whole. The content file is empty unless a case is about
content. Passwords are hashed with MD5, as in
tests/test_accounts_api.py, since the command sets one per account.
"""

from __future__ import annotations

import json
import re
from datetime import date
from io import StringIO
from typing import TYPE_CHECKING, Any

import pytest
from django.conf import settings as django_settings
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
    Importance,
    ReadingItem,
    Syllabus,
    SyllabusSection,
)
from apps.roles.management.commands.populate_demo import CONTENT, DATA, Command
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
            "editions": [
                {"academic_year": "2024-2025", "teaching_starts": "2025-02-24"},
                {"academic_year": "2025-2026", "teaching_starts": "2026-02-23"},
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
            "editions": [{"academic_year": "2025-2026", "teaching_starts": "2025-09-15"}],
        },
        {
            "code": "B000002",
            "name": "Elettronica e Misure C.I.",
            "locale": "it",
            "code_source": "cineca-only",
            "entries": [
                {"programme": "B046", "curriculum": "", "year_of_study": 2, "ad_code": "B000002"},
            ],
            # Offered in neither year: a study plan row with no edition.
            "editions": [],
        },
    ],
    "accounts": [
        {"username": "demo-admin", "superuser": True},
        {
            "username": "demo-secretariat",
            "first_name": "Giulia",
            "last_name": "Neri",
            "roles": [{"role": "secretariat", "programme": "B047"}],
        },
        {
            "username": "demo-teacher",
            "first_name": "Laura",
            "last_name": "Conti",
            "roles": [{"role": "teacher", "edition": "B028451:2025-2026"}],
        },
        {"username": "demo-student"},
    ],
}


@pytest.fixture(autouse=True)
def _fast_password_hashing(settings: Settings) -> None:
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


NO_CONTENT: dict[str, Any] = {"editions": []}


def run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    password: str | None,
    demo: dict[str, Any],
    content: dict[str, Any] = NO_CONTENT,
) -> str:
    """The command's output, run on `demo` and `content` with `DEMO_PASSWORD` set to `password`."""
    monkeypatch.setattr(env, "demo_password", None if password is None else SecretStr(password))
    data, texts = tmp_path / "demo.json", tmp_path / "content.json"
    data.write_text(json.dumps(demo), encoding="utf-8")
    texts.write_text(json.dumps(content), encoding="utf-8")
    out = StringIO()
    call_command("populate_demo", data=data, content=texts, stdout=out)
    return out.getvalue()


def snapshot() -> dict[str, list[Any]]:
    return {
        "programmes": sorted(DegreeProgramme.objects.values_list("code", "name")),
        "courses": sorted(Course.objects.values_list("code", "name", "code_source")),
        "entries": sorted(str(e) for e in CurriculumEntry.objects.select_related("programme")),
        "editions": sorted(
            (str(e), e.teaching_starts) for e in CourseEdition.objects.select_related("course")
        ),
        "roles": sorted(
            str(r) for r in RoleAssignment.objects.select_related("user", "programme", "edition")
        ),
        "accounts": sorted(
            (u.username, u.get_full_name(), u.is_superuser, u.is_staff, u.has_usable_password())
            for u in User.objects.all()
        ),
    }


DEMO_ACCOUNTS = [
    ("demo-admin", "", True, True, False),
    ("demo-secretariat", "Giulia Neri", False, False, False),
    ("demo-student", "", False, False, False),
    ("demo-teacher", "Laura Conti", False, False, False),
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
        "editions": [
            ("B000001:2025-2026", date(2025, 9, 15)),
            ("B028451:2024-2025", date(2025, 2, 24)),
            ("B028451:2025-2026", date(2026, 2, 23)),
        ],
        "roles": DEMO_ROLES,
        "accounts": DEMO_ACCOUNTS,
    }
    assert snapshot() == once
    assert (first.splitlines()[-1], second.splitlines()) == (
        "created 2 degree programmes, 3 courses, 5 curriculum entries, 3 course editions",
        ["created nothing"],
    )


def test_rows_of_its_own_are_kept_and_demo_accounts_made_the_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ppm = Course.objects.create(code="B028451", name="PPM")
    # One edition the file dates, one it does not name, and one it would date otherwise.
    CourseEdition.objects.create(course=ppm, academic_year="2025-2026")
    CourseEdition.objects.create(course=ppm, academic_year="2023-2024")
    CourseEdition.objects.create(
        course=ppm, academic_year="2024-2025", teaching_starts=date(2024, 10, 1)
    )
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
    again = run(tmp_path, monkeypatch, None, DEMO)

    assert (snapshot(), again.splitlines()) == (seen, ["created nothing"])
    assert ("B028451", "PPM", "moodle") in seen["courses"]
    assert [e for e in seen["editions"] if e[0].startswith("B028451")] == [
        ("B028451:2023-2024", None),
        ("B028451:2024-2025", date(2024, 10, 1)),
        ("B028451:2025-2026", date(2026, 2, 23)),
    ]
    assert "dated 1 course editions" in out.splitlines()
    assert (seen["roles"], seen["accounts"]) == (
        [*DEMO_ROLES, "mrossi · secretariat · B047"],
        sorted(
            [
                *DEMO_ACCOUNTS,
                ("demo-staff", "", False, False, False),
                ("mrossi", "", False, False, False),
            ]
        ),
    )
    assert sorted(line for line in out.splitlines() if " role " in line) == [
        "added role demo-secretariat · secretariat · B047",
        "added role demo-teacher · teacher · B028451:2025-2026",
        "removed role demo-staff · secretariat · B047",
        "removed role demo-teacher · secretariat · B047",
    ]


def test_the_shipped_files_load_and_give_the_demo_teacher_three_courses(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The real catalogue and content, through every model rule, on an empty database."""
    monkeypatch.setattr(env, "demo_password", None)
    call_command("populate_demo", stdout=StringIO())

    filled = {
        str(edition): (
            {
                locale: Syllabus.objects.filter(edition=edition, locale=locale).count()
                for locale in ("it", "en")
            },
            ReadingItem.objects.filter(edition=edition).count(),
        )
        for edition in CourseEdition.objects.filter(
            role_assignments__user__username="demo-teacher"
        ).select_related("course")
    }

    # Every section of the catalogue in both languages, but Fisica II's empty
    # Altro and PPM's English Programma esteso, which is the Italian text.
    assert filled == {
        "B003725:2026-2027": ({"it": 7, "en": 7}, 2),
        "B024251:2026-2027": ({"it": 6, "en": 6}, 1),
        "B028451:2026-2027": ({"it": 7, "en": 6}, 0),
    }
    assert DegreeProgramme.objects.count() == 3


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


CONTENT_FILE: dict[str, Any] = {
    "editions": [
        {
            "edition": "B028451:2025-2026",
            "syllabus": {
                "it": {"prerequisiti": "Programmazione.", "altro": "Materiale su Moodle."},
                "en": {"prerequisiti": "Programming."},
            },
            "readings": {
                "it": [
                    {"title": "Multimedia", "authors": "Rossi", "importance": "recommended"},
                    {
                        "title": "Web",
                        "authors": "Bianchi",
                        "year": 2020,
                        "importance": "recommended",
                    },
                ]
            },
        }
    ]
}


def content_rows() -> dict[str, list[Any]]:
    return {
        "syllabus": sorted(Syllabus.objects.values_list("locale", "section", "text")),
        "books": sorted(ReadingItem.objects.values_list("locale", "title", "year")),
    }


def test_content_fills_each_language_once_and_keeps_what_a_teacher_wrote(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = run(tmp_path, monkeypatch, None, DEMO, CONTENT_FILE)
    seeded = content_rows()
    second = run(tmp_path, monkeypatch, None, DEMO, CONTENT_FILE)
    # A teacher rewrites a section, clears another and removes a book; the
    # languages still hold content, so the next run brings nothing back.
    Syllabus.objects.filter(locale="it", section="prerequisiti").update(text="Python.")
    Syllabus.objects.filter(locale="it", section="altro").delete()
    ReadingItem.objects.filter(title="Web").delete()
    run(tmp_path, monkeypatch, None, DEMO, CONTENT_FILE)

    assert seeded == {
        "syllabus": [
            ("en", "prerequisiti", "Programming."),
            ("it", "altro", "Materiale su Moodle."),
            ("it", "prerequisiti", "Programmazione."),
        ],
        "books": [("it", "Multimedia", None), ("it", "Web", 2020)],
    }
    assert first.splitlines()[-1].endswith("3 syllabus sections, 2 reading items")
    assert second.splitlines()[-1] == "created nothing"
    assert content_rows() == {
        "syllabus": [("en", "prerequisiti", "Programming."), ("it", "prerequisiti", "Python.")],
        "books": [("it", "Multimedia", None)],
    }


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
        pytest.param(DEMO, None, "no edition B028451:2026-2027", id="content-of-no-edition"),
    ],
)
def test_a_refused_run_changes_nothing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    demo: dict[str, Any],
    taken: str | None,
    refusal: str,
) -> None:
    content = NO_CONTENT
    if refusal.startswith("no edition"):
        content = {"editions": [{**CONTENT_FILE["editions"][0], "edition": "B028451:2026-2027"}]}
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
        run(tmp_path, monkeypatch, None, demo, content)

    assert snapshot() == empty


def test_a_catalogue_of_its_own_gets_no_shipped_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The shipped syllabi name the shipped catalogue's editions: a catalogue given alone
    gets no content, rather than a refusal over editions it does not hold."""
    monkeypatch.setattr(env, "demo_password", None)
    data = tmp_path / "demo.json"
    data.write_text(json.dumps(DEMO), encoding="utf-8")

    call_command("populate_demo", data=data, stdout=StringIO())

    assert (
        CourseEdition.objects.exists(),
        Syllabus.objects.exists(),
        ReadingItem.objects.exists(),
    ) == (True, False, False)


def test_the_demo_data_file_keeps_the_catalogue_rules() -> None:
    """The shipped file, read without a database: codes, code sources, entries, one course
    per AD code, and editions of the kept years, each with one start day in its years."""
    demo = json.loads(DATA.read_text(encoding="utf-8"))
    editions = [(c["code"], e) for c in demo["courses"] for e in c["editions"]]
    named = [f"{code}:{e['academic_year']}" for code, e in editions]
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
    assert {e["academic_year"] for _, e in editions} == {"2025-2026", "2026-2027"}
    assert len(named) == len(set(named))
    assert [e for _, e in editions if set(e) != {"academic_year", "teaching_starts"}] == []
    # A day, in one of the edition's two years, as `CourseEdition.clean()` asks.
    assert [
        e
        for _, e in editions
        if str(date.fromisoformat(e["teaching_starts"]).year) not in e["academic_year"].split("-")
    ] == []
    teacher = next(a for a in demo["accounts"] if a["username"] == "demo-teacher")
    assert [role["edition"] for role in teacher["roles"]] == [
        "B003725:2026-2027",
        "B024251:2026-2027",
        "B028451:2026-2027",
    ]
    assert {role["edition"] for role in teacher["roles"]} <= set(named)


def test_the_demo_content_file_fits_the_catalogue_and_names_no_teacher() -> None:
    """The shipped content, read without a database: every edition it fills is one the
    catalogue file creates, with the models' sections, languages and importances; and
    neither file names a real teacher, the demo's own being Demo Teacher."""
    demo = json.loads(DATA.read_text(encoding="utf-8"))
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    named = {f"{c['code']}:{e['academic_year']}" for c in demo["courses"] for e in c["editions"]}
    filled = content["editions"]
    languages = {code for code, _ in django_settings.LANGUAGES}
    books = [book for e in filled for shelf in e["readings"].values() for book in shelf]
    teachers = re.compile("frasconi|del zanna|bertini", re.IGNORECASE)

    assert {e["edition"] for e in filled} <= named
    assert {loc for e in filled for loc in (*e["syllabus"], *e["readings"])} <= languages
    assert {s for e in filled for texts in e["syllabus"].values() for s in texts} <= set(
        SyllabusSection.values
    )
    assert {book["importance"] for book in books} == {Importance.RECOMMENDED}
    assert teachers.search(DATA.read_text(encoding="utf-8") + json.dumps(content)) is None
