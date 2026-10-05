"""The catalogue API, asked by each kind of caller in `world()` (tests/test_roles.py).

What each caller gets is gathered into one mapping and compared whole, so a
failure shows exactly which caller got what; a refusal is compared by the code
it carries (config/exceptions.py), which is what a page reads. A case that writes runs inside a
transaction rolled back after it, so every case starts from the same world
without building it again. Every caller logs in through `force_login`,
which costs no password hash, and the session is real. `APIClient` skips the
CSRF check unless asked, and one test asks: a write without the token is
refused.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from test_roles import everyone, label, world

from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.roles.grants import revoke
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http.response import HttpResponseBase

    from apps.accounts.models import User

pytestmark = pytest.mark.django_db

EDITIONS_URL = "/api/catalog/editions"
PROGRAMMES_URL = "/api/catalog/programmes"
COURSES_URL = "/api/catalog/courses"
OLD, NEW = "B028451:2024-2025", "B028451:2025-2026"  # PPM's editions; the old one is current

TEACHES = ["edition.set_current", "edition.view"]
RUNS_EDITION = ["edition.assign_teacher", "edition.set_current", "edition.view"]


def as_user(user: User | None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_login(user)
    return client


def code_of(response: HttpResponseBase) -> str | None:
    """The code of a refusal of the whole request; None when Django, not DRF, answered."""
    if not response["Content-Type"].startswith("application/json"):
        return None
    return response.json()["detail"]["code"]  # pyright: ignore[reportAttributeAccessIssue]


def switch_url(edition: CourseEdition) -> str:
    return f"/api/catalog/editions/{edition.pk}/set-current"


def row_label(row: dict[str, Any]) -> str:
    """An edition as the API lists it, spelt CODE:YEAR like `label()`."""
    return f"{row['course']['code']}:{row['academic_year']}"


def usernames(members: list[dict[str, Any]]) -> list[str]:
    return [member["username"] for member in members]


def test_each_caller_lists_their_own_scope() -> None:
    w = world()
    # PPM in B047's second curriculum too: two entries, one course in the count.
    CurriculumEntry.objects.create(
        programme=w.b047,
        course=w.ppm_old.course,
        curriculum="TECNICO SCIENTIFICO",
        year_of_study=3,
        ad_code="B003712",
    )
    reads = {label(e): f"{EDITIONS_URL}/{e.pk}" for e in (w.ppm_old, w.ppm_new, w.ia, w.shared)}
    reads |= {p.code: f"{PROGRAMMES_URL}/{p.code}" for p in (w.b047, w.l031)}

    seen: dict[str, object] = {}
    teachers: dict[str, set[tuple[str, ...]]] = {}
    # Reading one scope answers what the list says of it, and 404 for what it leaves out.
    unlike_the_list: dict[str, list[str]] = {}
    for user in (*everyone(w), None):
        client = as_user(user)
        editions, programmes = client.get(EDITIONS_URL), client.get(PROGRAMMES_URL)
        name = user.username if user is not None else "anonymous"
        read = {key: client.get(url) for key, url in reads.items()}
        if editions.status_code != 200:
            statuses = sorted({response.status_code for response in read.values()})
            seen[name] = (editions.status_code, programmes.status_code, statuses)
            continue
        rows = {row_label(e): e for e in editions.json()} | {
            p["code"]: p for p in programmes.json()
        }
        answered = {
            key: response.json() if response.status_code == 200 else response.status_code
            for key, response in read.items()
        }
        if differ := sorted(key for key in reads if answered[key] != rows.get(key, 404)):
            unlike_the_list[name] = differ
        for e in editions.json():
            teachers.setdefault(row_label(e), set()).add(
                tuple(t["username"] for t in e["teachers"])
            )
        seen[name] = (
            {row_label(e): (e["permissions"], e["can_set_current"]) for e in editions.json()},
            {
                p["code"]: (
                    p["permissions"],
                    p["curricula"],
                    p["course_count"],
                    usernames(p["secretariat"]),
                )
                for p in programmes.json()
            },
        )

    ppm_old, ppm_new, ia, shared = OLD, NEW, "B003725:2025-2026", "B000001:2025-2026"
    teaches, runs = (TEACHES, True), (RUNS_EDITION, True)
    # Curricula, course count, secretariat: an empty curriculum is no name, and
    # a disabled account still holds its row until someone revokes it.
    b047 = (["TECNICO SCIENTIFICO"], 2, ["dual", "inactive", "secretariat"])
    l031 = ([], 2, ["other_secretariat"])
    views, assigns = ["programme.view"], ["programme.assign_secretariat", "programme.view"]
    assert seen == {
        "continuing": ({ppm_old: teaches, ppm_new: teaches}, {}),
        # The switch to the new year would replace last year's edition, which
        # this teacher does not teach (test_switching_the_current_edition).
        "newcomer": ({ppm_new: (TEACHES, False)}, {}),
        "secretariat": (
            {ppm_old: runs, ppm_new: runs, shared: runs},
            {"B047": (views, *b047)},
        ),
        "other_secretariat": (
            {ia: runs, shared: runs},
            {"L031": (views, *l031)},
        ),
        "dual": (
            {ia: teaches, ppm_old: runs, ppm_new: runs, shared: runs},
            {"B047": (views, *b047)},
        ),
        "student": ({}, {}),
        "root": (
            {ppm_old: runs, ppm_new: runs, ia: runs, shared: runs},
            {"B047": (assigns, *b047), "L031": (assigns, *l031)},
        ),
        # A disabled account has no session, whatever it held.
        "inactive": (403, 403, [403]),
        "anonymous": (403, 403, [403]),
    }
    assert unlike_the_list == {}
    # Whoever lists an edition sees the same teachers on it.
    assert teachers == {
        ppm_old: {("continuing",)},
        ppm_new: {("continuing", "newcomer")},
        ia: {("dual",)},
        shared: {()},
    }


def test_each_caller_reads_courses_and_study_plans() -> None:
    w = world()
    # A course B047 lists with no edition yet: a row of its study plan all the same.
    planned = Course.objects.create(code="B000002", name="Fisica")
    CurriculumEntry.objects.create(
        programme=w.b047, course=planned, year_of_study=2, ad_code="B000002"
    )
    urls = {
        "PPM": f"{COURSES_URL}/B028451",
        "shared": f"{COURSES_URL}/B000001",
        "IA": f"{COURSES_URL}/B003725",
        "B047 plan": f"{PROGRAMMES_URL}/B047/courses",
        "L031 plan": f"{PROGRAMMES_URL}/L031/courses",
    }

    seen: dict[str, dict[str, object]] = {}
    read: dict[str, dict[str, Any]] = {}
    for user in (*everyone(w), None):
        client = as_user(user)
        name = user.username if user is not None else "anonymous"
        answers = {key: client.get(url) for key, url in urls.items()}
        read[name] = {key: r.json() for key, r in answers.items() if r.status_code == 200}
        # A study plan by the codes of its courses, a course by its status.
        seen[name] = {
            key: [row["course"]["code"] for row in read[name][key]]
            if key in read[name] and key.endswith("plan")
            else r.status_code
            for key, r in answers.items()
        }

    hidden, refused = dict.fromkeys(urls, 404), dict.fromkeys(urls, 403)
    b047_plan, l031_plan = ["B000001", "B000002", "B028451"], ["B000001", "B003725"]
    b047_staff = {"PPM": 200, "shared": 200, "IA": 404, "B047 plan": b047_plan, "L031 plan": 404}
    assert seen == {
        # A teacher views no programme, so no course: their editions are in the edition list.
        "continuing": hidden,
        "newcomer": hidden,
        "secretariat": b047_staff,
        "other_secretariat": {
            "PPM": 404,
            "shared": 200,
            "IA": 200,
            "B047 plan": 404,
            "L031 plan": l031_plan,
        },
        # Teaching IA opens no course of L031: only the programme they run does.
        "dual": b047_staff,
        "student": hidden,
        "root": {
            "PPM": 200,
            "shared": 200,
            "IA": 200,
            "B047 plan": b047_plan,
            "L031 plan": l031_plan,
        },
        "inactive": refused,
        "anonymous": refused,
    }

    b047 = {"code": "B047", "name": "Ingegneria Informatica", "locale": "it"}
    l031 = {"code": "L031", "name": "Informatica", "locale": "it"}

    def course(code: str, name: str, *entries: tuple[dict[str, str], int]) -> dict[str, Any]:
        return {
            "code": code,
            "name": name,
            "locale": "it",
            "code_source": "moodle",
            "entries": [
                {"programme": programme, "curriculum": "", "year_of_study": year, "ad_code": code}
                for programme, year in entries
            ],
        }

    assert read["secretariat"]["B047 plan"] == [
        {
            "course": course("B000001", "Analisi Matematica I", (b047, 1), (l031, 1)),
            "current_edition": {"id": w.shared.pk, "academic_year": "2025-2026", "teachers": []},
        },
        {"course": course("B000002", "Fisica", (b047, 2)), "current_edition": None},
        {
            "course": course("B028451", "Progettazione e Produzione Multimediale", (b047, 3)),
            "current_edition": {
                "id": w.ppm_old.pk,
                "academic_year": "2024-2025",
                "teachers": [{"id": w.continuing.pk, "username": "continuing"}],
            },
        },
    ]
    # A course reads as its row of the study plan shows it.
    assert read["secretariat"]["shared"] == read["secretariat"]["B047 plan"][0]["course"]
    # The shared course names L031, a public fact; L031's staff stays behind
    # L031's own scope, whose page and study plan are a 404 above.
    assert "other_secretariat" not in str(read["secretariat"])


def test_the_edition_list_narrows_to_a_course() -> None:
    w = world()
    asked = {
        "secretariat, a course of their programme": (w.secretariat, "B028451"),
        "secretariat, a course of another programme": (w.secretariat, "B003725"),
        "superuser, an unknown code": (w.root, "X999"),
        "superuser, a NUL byte": (w.root, "B028451\x00"),
        # A teacher gets the editions they teach, and no other of the course.
        "teacher of the new year": (w.newcomer, "B028451"),
    }

    seen = {
        case: [row_label(e) for e in as_user(user).get(EDITIONS_URL, {"course": code}).json()]
        for case, (user, code) in asked.items()
    }

    assert seen == {
        "secretariat, a course of their programme": [NEW, OLD],
        "secretariat, a course of another programme": [],
        "superuser, an unknown code": [],
        "superuser, a NUL byte": [],
        "teacher of the new year": [NEW],
    }


def rolled_back[T](call: Callable[[], T]) -> T:
    """What `call` returns, with every row it wrote undone, so the next case starts afresh."""
    with transaction.atomic():
        result = call()
        transaction.set_rollback(True)
    return result


def test_switching_the_current_edition() -> None:
    w = world()

    def switch(user: User | None, method: str) -> tuple[int, str, str | None]:
        response = getattr(as_user(user), method)(switch_url(w.ppm_new))
        if response.status_code == 200:
            body = response.json()
            now = body["id"] == w.ppm_new.pk and body["is_current"]
            said = "the edition, now current" if now else None
        else:
            said = code_of(response)
        current = CourseEdition.objects.get(course__code="B028451", is_current=True)
        return response.status_code, label(current), said

    cases = {
        "teacher of both years": (w.continuing, "post"),
        "first-year teacher": (w.newcomer, "post"),
        "secretariat": (w.secretariat, "post"),
        "other programme's secretariat": (w.other_secretariat, "post"),
        "student": (w.student, "post"),
        "anonymous": (None, "post"),
        "GET": (w.continuing, "get"),
    }
    seen = {
        case: rolled_back(lambda user=user, method=method: switch(user, method))
        for case, (user, method) in cases.items()
    }

    assert seen == {
        # The teacher of both years may replace last year's edition.
        "teacher of both years": (200, NEW, "the edition, now current"),
        # A first-year teacher may not replace last year's edition, and the
        # refusal says so: the secretariat switches it for them.
        "first-year teacher": (403, OLD, "switch_needs_both"),
        "secretariat": (200, NEW, "the edition, now current"),
        "other programme's secretariat": (404, OLD, "not_found"),
        "student": (404, OLD, "not_found"),
        "anonymous": (403, OLD, "not_authenticated"),
        "GET": (405, OLD, "method_not_allowed"),
    }

    # The flag every listed row carries is the switch's own answer: each row is
    # posted for real, in a transaction rolled back, once as the world is and
    # once with PPM's current edition cleared, where a switch replaces nothing.
    # A row a caller does not list is a 404 to them, pinned above.
    def flags_and_answers() -> dict[tuple[str, str], tuple[bool, int]]:
        cells: dict[tuple[str, str], tuple[bool, int]] = {}
        for user in everyone(w):
            if not user.is_active:
                continue
            client = as_user(user)
            for row in client.get(EDITIONS_URL).json():
                answer = rolled_back(
                    lambda client=client, row=row: (
                        client.post(f"{EDITIONS_URL}/{row['id']}/set-current").status_code
                    )
                )
                cells[(user.username, row_label(row))] = (row["can_set_current"], answer)
        return cells

    def without_a_current_ppm_edition() -> dict[tuple[str, str], tuple[bool, int]]:
        # Not through set_current(), which only ever moves the flag.
        CourseEdition.objects.filter(pk=w.ppm_old.pk).update(is_current=False)
        return flags_and_answers()

    variants = {
        "as the world is": flags_and_answers(),
        "no current PPM edition": rolled_back(without_a_current_ppm_edition),
    }
    cells = {
        (variant, *cell): pair
        for variant, found in variants.items()
        for cell, pair in found.items()
    }
    assert {cell: pair for cell, pair in cells.items() if pair[0] != (pair[1] == 200)} == {}
    assert {cell for cell, (flag, _) in cells.items() if not flag} == {
        ("as the world is", "newcomer", NEW)
    }


def test_a_write_without_the_csrf_token_is_refused() -> None:
    w = world()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(w.continuing)

    response = client.post(switch_url(w.ppm_new))

    assert response.status_code == 403
    assert CourseEdition.objects.get(pk=w.ppm_old.pk).is_current


@pytest.mark.parametrize(
    ("url", "rows"),
    [
        pytest.param(EDITIONS_URL, (3, 6), id="editions"),
        pytest.param(PROGRAMMES_URL, (1, 2), id="programmes"),
        pytest.param(f"{PROGRAMMES_URL}/B047/courses", (2, 3), id="study-plan"),
        # A course's rows are its entries.
        pytest.param(f"{COURSES_URL}/B000001", (2, 3), id="course"),
    ],
)
def test_each_read_costs_the_same_for_more_rows(url: str, rows: tuple[int, int]) -> None:
    w = world()
    client = as_user(w.secretariat)

    def queries() -> tuple[int, int]:
        with CaptureQueriesContext(connection) as captured:
            body = client.get(url).json()
        return len(body if isinstance(body, list) else body["entries"]), len(
            captured.captured_queries
        )

    few = queries()
    # More editions, and teachers on editions that had none; a second programme
    # this caller runs, with its staff and an entry for the shared course; and
    # a new course in two of B047's curricula, current and taught.
    for year in ("2022-2023", "2023-2024"):
        edition = CourseEdition.objects.create(course=w.ppm_old.course, academic_year=year)
        RoleAssignment.objects.create(user=w.newcomer, role=Role.TEACHER, edition=edition)
    RoleAssignment.objects.create(user=w.student, role=Role.TEACHER, edition=w.shared)
    b046 = DegreeProgramme.objects.create(code="B046", name="Ingegneria Elettronica")
    physics = Course.objects.create(code="B000002", name="Fisica")
    CurriculumEntry.objects.bulk_create(
        [
            CurriculumEntry(
                programme=b046, course=w.shared.course, year_of_study=1, ad_code="B000001"
            ),
            CurriculumEntry(
                programme=w.b047,
                course=physics,
                curriculum="TECNICO APPLICATIVO",
                year_of_study=2,
                ad_code="B000002",
            ),
            CurriculumEntry(
                programme=w.b047,
                course=physics,
                curriculum="TECNICO SCIENTIFICO",
                year_of_study=2,
                ad_code="B000003",
            ),
        ]
    )
    current = CourseEdition.objects.create(
        course=physics, academic_year="2025-2026", is_current=True
    )
    RoleAssignment.objects.bulk_create(
        [
            RoleAssignment(user=w.secretariat, role=Role.SECRETARIAT, programme=b046),
            RoleAssignment(user=w.student, role=Role.SECRETARIAT, programme=b046),
            RoleAssignment(user=w.student, role=Role.TEACHER, edition=current),
        ]
    )
    more = queries()

    assert (few[0], more[0]) == rows
    assert few[1] == more[1]


def teachers(edition: CourseEdition) -> str:
    return f"/api/catalog/editions/{edition.pk}/teachers"


def secretariat(code: str) -> str:
    return f"/api/catalog/programmes/{code}/secretariat"


def grant_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "apps.roles.grants"]


def test_granting_and_revoking_staff(
    django_capture_on_commit_callbacks, caplog: pytest.LogCaptureFixture
) -> None:
    w = world()
    before = {str(row) for row in RoleAssignment.objects.all()}

    def attempt(
        user: User, method: str, path: str, body: dict[str, str] | None
    ) -> tuple[int, list[str], list[str], list[str]]:
        caplog.clear()
        # The log line is written on commit; the test's transaction never
        # commits, so the callbacks are run here, before the case is undone.
        with django_capture_on_commit_callbacks(execute=True):
            response = getattr(as_user(user), method)(path, body)
        after = {str(row) for row in RoleAssignment.objects.all()}
        return (
            response.status_code,
            sorted(after - before),
            sorted(before - after),
            grant_lines(caplog),
        )

    new, b047, student = teachers(w.ppm_new), secretariat("B047"), {"username": "student"}
    cases = {
        "secretariat grants a teacher": (w.secretariat, "post", new, student),
        "superuser grants a teacher": (w.root, "post", new, student),
        "superuser grants secretariat staff": (w.root, "post", b047, student),
        "secretariat revokes a teacher": (w.secretariat, "delete", f"{new}/newcomer", None),
        "superuser revokes a teacher": (w.root, "delete", f"{new}/newcomer", None),
        "superuser revokes secretariat staff": (w.root, "delete", f"{b047}/secretariat", None),
    }
    with caplog.at_level("INFO", logger="apps.roles.grants"):
        seen = {case: rolled_back(lambda args=args: attempt(*args)) for case, args in cases.items()}

    teacher_row = "student · teacher · B028451:2025-2026"
    newcomer_row = "newcomer · teacher · B028451:2025-2026"
    assert seen == {
        "secretariat grants a teacher": (
            201,
            [teacher_row],
            [],
            ["granted teacher on B028451:2025-2026 to student by secretariat"],
        ),
        "superuser grants a teacher": (
            201,
            [teacher_row],
            [],
            ["granted teacher on B028451:2025-2026 to student by root"],
        ),
        "superuser grants secretariat staff": (
            201,
            ["student · secretariat · B047"],
            [],
            ["granted secretariat on B047 to student by root"],
        ),
        "secretariat revokes a teacher": (
            204,
            [],
            [newcomer_row],
            ["revoked teacher on B028451:2025-2026 from newcomer by secretariat"],
        ),
        "superuser revokes a teacher": (
            204,
            [],
            [newcomer_row],
            ["revoked teacher on B028451:2025-2026 from newcomer by root"],
        ),
        "superuser revokes secretariat staff": (
            204,
            [],
            ["secretariat · secretariat · B047"],
            ["revoked secretariat on B047 from secretariat by root"],
        ),
    }


def test_staff_requests_that_change_nothing(
    django_capture_on_commit_callbacks, caplog: pytest.LogCaptureFixture
) -> None:
    w = world()
    rows = RoleAssignment.objects.count()
    new, ia, b047 = teachers(w.ppm_new), teachers(w.ia), secretariat("B047")
    student, nobody = {"username": "student"}, {"username": "nobody"}
    requests = {
        # Assigning outside one's scope is a 404, inside it without the
        # assign permission a 403; teachers assign nobody.
        "other programme's secretariat assigns in PPM": (w.other_secretariat, "post", new, student),
        "teacher assigns a teacher": (w.continuing, "post", new, student),
        "teacher assigns on another course": (w.newcomer, "post", ia, student),
        "student assigns": (w.student, "post", new, student),
        "anonymous assigns": (None, "post", new, student),
        # The scope first, then the permission, then the body: an unknown
        # username is told apart only to a caller who may assign here.
        "student names nobody": (w.student, "post", new, nobody),
        "teacher names nobody": (w.continuing, "post", new, nobody),
        "secretariat names nobody": (w.secretariat, "post", new, nobody),
        "secretariat grants what is held": (w.secretariat, "post", new, {"username": "newcomer"}),
        # Only the superuser assigns secretariat staff.
        "secretariat assigns secretariat": (w.secretariat, "post", b047, student),
        "teacher assigns secretariat": (w.continuing, "post", b047, student),
        "other programme's secretariat revokes": (
            w.other_secretariat,
            "delete",
            f"{new}/newcomer",
            None,
        ),
        "teacher revokes": (w.continuing, "delete", f"{new}/newcomer", None),
        "secretariat revokes a non-member": (w.secretariat, "delete", f"{new}/student", None),
        "secretariat revokes their own row": (w.secretariat, "delete", f"{b047}/secretariat", None),
        # Members are read on the scope's own row, so no collection answers a GET,
        # whoever asks: the method is refused before any scope is looked up.
        "teacher reads the teachers": (w.continuing, "get", new, None),
        "student reads the teachers": (w.student, "get", new, None),
        "secretariat reads the secretariat": (w.secretariat, "get", b047, None),
        "GET on a member": (w.secretariat, "get", f"{new}/newcomer", None),
        "DELETE on the collection": (w.secretariat, "delete", new, None),
        # OPTIONS would describe a POST the caller may not make.
        "OPTIONS on the collection": (w.continuing, "options", new, None),
        # A key no programme or user can have is not looked up at all.
        "a programme code with a NUL byte": (w.root, "get", secretariat("%00"), None),
        "a username with a NUL byte": (w.root, "delete", f"{new}/%00", None),
    }

    seen: dict[str, object] = {}
    with (
        caplog.at_level("INFO", logger="apps.roles.grants"),
        django_capture_on_commit_callbacks(execute=True),
    ):
        for case, (user, method, path, body) in requests.items():
            response = getattr(as_user(user), method)(path, body)
            if response.status_code == 400:
                seen[case] = (400, response.json())
            else:
                seen[case] = (response.status_code, code_of(response))

    assert seen == {
        "other programme's secretariat assigns in PPM": (404, "not_found"),
        "teacher assigns a teacher": (403, "permission_denied"),
        "teacher assigns on another course": (404, "not_found"),
        "student assigns": (404, "not_found"),
        "anonymous assigns": (403, "not_authenticated"),
        "student names nobody": (404, "not_found"),
        "teacher names nobody": (403, "permission_denied"),
        # A field's refusal, in the same envelope DRF gives it, each message with its code.
        "secretariat names nobody": (
            400,
            {"username": [{"message": "No such user.", "code": "no_such_user"}]},
        ),
        "secretariat grants what is held": (
            400,
            {
                "username": [
                    {"message": "This user already holds this role here.", "code": "already_held"}
                ]
            },
        ),
        "secretariat assigns secretariat": (403, "permission_denied"),
        "teacher assigns secretariat": (404, "not_found"),
        "other programme's secretariat revokes": (404, "not_found"),
        "teacher revokes": (403, "permission_denied"),
        "secretariat revokes a non-member": (404, "not_found"),
        "secretariat revokes their own row": (403, "permission_denied"),
        "teacher reads the teachers": (405, "method_not_allowed"),
        "student reads the teachers": (405, "method_not_allowed"),
        "secretariat reads the secretariat": (405, "method_not_allowed"),
        "GET on a member": (405, "method_not_allowed"),
        "DELETE on the collection": (405, "method_not_allowed"),
        "OPTIONS on the collection": (405, "method_not_allowed"),
        # No route matches, so Django answers before any view, with no code.
        "a programme code with a NUL byte": (404, None),
        "a username with a NUL byte": (404, None),
    }
    assert RoleAssignment.objects.count() == rows
    assert grant_lines(caplog) == []


def test_a_grant_is_logged_once_it_commits(
    django_capture_on_commit_callbacks, caplog: pytest.LogCaptureFixture
) -> None:
    w = world()

    with (
        caplog.at_level("INFO", logger="apps.roles.grants"),
        django_capture_on_commit_callbacks(execute=False) as callbacks,
    ):
        response = as_user(w.secretariat).post(teachers(w.ppm_new), {"username": "student"})
    uncommitted = grant_lines(caplog)
    with caplog.at_level("INFO", logger="apps.roles.grants"):
        for callback in callbacks:
            callback()

    assert (response.status_code, uncommitted, len(callbacks)) == (201, [], 1)
    assert grant_lines(caplog) == ["granted teacher on B028451:2025-2026 to student by secretariat"]


def test_a_revocation_is_logged_once(
    django_capture_on_commit_callbacks, caplog: pytest.LogCaptureFixture
) -> None:
    """Two revocations of one row, as two requests racing would make them: one line."""
    w = world()
    row = RoleAssignment.objects.get(user=w.newcomer, edition=w.ppm_new)
    stale = RoleAssignment.objects.get(pk=row.pk)

    with (
        caplog.at_level("INFO", logger="apps.roles.grants"),
        django_capture_on_commit_callbacks(execute=True),
    ):
        first, second = revoke(w.secretariat, row), revoke(w.secretariat, stale)

    assert (first, second) == (True, False)
    assert grant_lines(caplog) == [
        "revoked teacher on B028451:2025-2026 from newcomer by secretariat"
    ]
