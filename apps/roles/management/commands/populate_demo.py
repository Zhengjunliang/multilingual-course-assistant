"""Fill the database with the demo: three real programmes, their courses in the years they are
offered, the demo teacher's syllabi and books, and its staff.

    uv run python manage.py populate_demo  # demo_catalog.json, demo_content.json, beside this file
    uv run python manage.py populate_demo --data <path> --content <path>

A demo seed, as Saleor's `populatedb` and Zulip's `populate_db` are (outside
the repository), not an import path: the catalogue is entered in the admin. Each
data file names its source and the rules it was transcribed by. The command
merges by natural key, so it runs again at any time, on an empty database or
on one holding rows of its own:

- A programme by code, a course by code, a curriculum entry by programme,
  curriculum and course, an edition by course and year: created when missing,
  never changed when present, but for an edition with no teaching start or no
  period, which gets the file's. Each new row passes `full_clean()` first, so the models' own
  rules — an AD code belongs to one course (apps/catalog/models.py) — stop a
  bad data file at the row that breaks them. A course the file marks
  `code_source: cineca-only` is created so; one with no mark, as from its
  Moodle course. A row the file does not name is kept, an edition included.
- No edition is made current: which one is follows its teaching start
  (apps/catalog/editions.py).
- Content: an edition gets the content file's syllabus, and its language, only
  when it holds no section, and its books only when it holds no book, so a run
  never overwrites what a teacher wrote. The
  shipped content names the shipped catalogue's editions, so a catalogue file
  given without a content file gets none.
- Accounts: `demo-` ones only, and the file may name no other. A declared
  account's name, superuser flag, role rows and programme (`StudentProgramme`)
  are made the file's, rows it does not declare removed; a `demo-` account
  the file does not name keeps the account and loses its role rows, so the
  demo holds exactly the roles the file shows.
  An account switched off in the admin stays off: every demo account shares
  `DEMO_PASSWORD`, so switching `demo-admin` off is how a site others can reach
  keeps the superuser's door shut. An account outside `demo-` is never touched.
- Passwords: with `DEMO_PASSWORD` set (config/env.py), every declared account
  gets it, on every run, once the password rules accept it for that account.
  Without it a new account gets no usable password, and a declared account
  that already has a usable one stops the run: anyone may register, so a
  stranger could have taken `demo-admin` first, and this command would make
  them the superuser.

It all runs in one transaction, so a run that stops leaves nothing behind. Role
rows written here go through neither apps/roles/grants.py nor the admin, so the
command prints each one it adds or removes.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import StudentProgramme, User
from apps.accounts.passwords import set_password_checked
from apps.catalog.models import (
    CodeSource,
    Course,
    CourseEdition,
    CurriculumEntry,
    DegreeProgramme,
    ReadingItem,
    Syllabus,
)
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role
from config.env import env

if TYPE_CHECKING:
    from django.core.management.base import CommandParser
    from django.db.models import Model

DATA = Path(__file__).with_name("demo_catalog.json")
CONTENT = Path(__file__).with_name("demo_content.json")
PREFIX = "demo-"


class Command(BaseCommand):
    help = "Merge the demo catalogue and its demo- accounts into the database."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--data", type=Path, default=DATA, help="the catalogue file (default: %(default)s)"
        )
        parser.add_argument(
            "--content",
            type=Path,
            default=None,
            help=f"the editions' syllabi and books (default: {CONTENT}, with the shipped --data)",
        )

    def handle(self, *args: object, data: Path, content: Path | None, **options: object) -> None:
        demo = json.loads(data.read_text(encoding="utf-8"))
        if content is None and data.resolve() == DATA.resolve():
            content = CONTENT
        texts = (
            {"editions": []} if content is None else json.loads(content.read_text(encoding="utf-8"))
        )
        secret = env.demo_password.get_secret_value() if env.demo_password is not None else ""
        password = secret or None
        strangers = [
            a["username"] for a in demo["accounts"] if not a["username"].startswith(PREFIX)
        ]
        if strangers:
            raise CommandError(f"the data file names accounts outside {PREFIX}: {strangers}")
        self.created: dict[str, int] = {}
        self.dated = 0
        with transaction.atomic():
            self._catalogue(demo)
            self._content(texts)
            for account in demo["accounts"]:
                self._account(account, password)
            declared = [a["username"] for a in demo["accounts"]]
            undeclared = RoleAssignment.objects.filter(user__username__startswith=PREFIX).exclude(
                user__username__in=declared
            )
            for row in undeclared.select_related("user", "programme", "edition__course"):
                row.delete()
                self.stdout.write(f"removed role {row}")
        if self.dated:
            self.stdout.write(f"dated {self.dated} course editions")
        made = ", ".join(f"{count} {name}" for name, count in self.created.items()) or "nothing"
        self.stdout.write(f"created {made}")

    def _merge[M: Model](self, model: type[M], key: dict[str, Any], fields: dict[str, Any]) -> M:
        """The row `key` names, created with `fields` when there is none."""
        row = model._default_manager.filter(**key).first()
        return row if row is not None else self._create(model(**key, **fields))

    def _create[M: Model](self, row: M) -> M:
        """`row`, checked by its model's rules, saved and counted."""
        self._check(row)
        row.save()
        name = str(row._meta.verbose_name_plural)
        self.created[name] = self.created.get(name, 0) + 1
        return row

    def _check(self, row: Model) -> None:
        """`row` held to its model's rules; one it breaks stops the run."""
        try:
            row.full_clean()
        except ValidationError as exc:
            raise CommandError(f"{row._meta.verbose_name} {row}: {exc.messages}") from None

    def _catalogue(self, demo: dict[str, Any]) -> None:
        programmes = {
            p["code"]: self._merge(
                DegreeProgramme, {"code": p["code"]}, {"name": p["name"], "locale": p["locale"]}
            )
            for p in demo["programmes"]
        }
        for c in demo["courses"]:
            course = self._merge(
                Course,
                {"code": c["code"]},
                {
                    "name": c["name"],
                    "locale": c["locale"],
                    "code_source": c.get("code_source", CodeSource.MOODLE),
                },
            )
            for e in c["entries"]:
                self._merge(
                    CurriculumEntry,
                    {
                        "programme": programmes[e["programme"]],
                        "curriculum": e["curriculum"],
                        "course": course,
                    },
                    {"year_of_study": e["year_of_study"], "ad_code": e["ad_code"]},
                )
            for e in c["editions"]:
                starts = date.fromisoformat(e["teaching_starts"])
                edition = self._merge(
                    CourseEdition,
                    {"course": course, "academic_year": e["academic_year"]},
                    {"teaching_starts": starts, "period": e["period"]},
                )
                missing = {
                    field: value
                    for field, value in (("teaching_starts", starts), ("period", e["period"]))
                    if not getattr(edition, field)
                }
                if missing:
                    for field, value in missing.items():
                        setattr(edition, field, value)
                    self._check(edition)
                    edition.save(update_fields=list(missing))
                    self.dated += 1

    def _content(self, texts: dict[str, Any]) -> None:
        for e in texts["editions"]:
            code, _, year = e["edition"].partition(":")
            edition = CourseEdition.objects.filter(course__code=code, academic_year=year).first()
            if edition is None:
                raise CommandError(f"no edition {e['edition']} to hold its content")
            syllabus = e["syllabus"]
            if not Syllabus.objects.filter(edition=edition).exists():
                edition.syllabus_locale = syllabus["locale"]
                self._check(edition)
                edition.save(update_fields=["syllabus_locale"])
                for section, text in syllabus["sections"].items():
                    self._create(Syllabus(edition=edition, section=section, text=text))
            if not ReadingItem.objects.filter(edition=edition).exists():
                for book in e["readings"]:
                    self._create(ReadingItem(edition=edition, **book))

    def _account(self, account: dict[str, Any], password: str | None) -> None:
        # Checked here, inside the transaction, and not before the run: a name
        # registered while the catalogue is written is read here, and one
        # registered after this read makes the save below break the unique
        # username, so neither is taken over.
        username = account["username"]
        user = User.objects.filter(username=username).first() or User(username=username)
        if password is not None:
            # Checked by the rules a registration meets, with this account: a
            # demo account open to others is the last one to get a weak one. A
            # new hash would end the account's sessions (Django ties each
            # session to it), so a run with the same password leaves the hash
            # alone, and still checks it: one stored before the rules is no
            # less weak.
            try:
                if user.check_password(password):
                    validate_password(password, user=user)
                else:
                    set_password_checked(user, password)
            except ValidationError as exc:
                raise CommandError(
                    f"DEMO_PASSWORD is refused for {username}: {' '.join(exc.messages)}"
                ) from exc
        elif user.pk is None:
            user.set_unusable_password()
        elif user.has_usable_password():
            raise CommandError(
                f"{username} already has a password of its own; set DEMO_PASSWORD to take "
                "it over, or delete it"
            )
        user.is_superuser = user.is_staff = account.get("superuser", False)
        # The name the staff pages show over the username; the file owns it as
        # it owns the rest of a demo account.
        user.first_name = account.get("first_name", "")
        user.last_name = account.get("last_name", "")
        user.full_clean()
        user.save()

        wanted = [self._role_row(user, role) for role in account.get("roles", [])]
        held = list(
            RoleAssignment.objects.filter(user=user).select_related("programme", "edition__course")
        )
        for row in held:
            if not any(_same(row, want) for want in wanted):
                row.delete()
                self.stdout.write(f"removed role {row}")
        for want in wanted:
            if not any(_same(row, want) for row in held):
                want.full_clean()
                want.save()
                self.stdout.write(f"added role {want}")
        code = account.get("programme")
        programme = None if code is None else DegreeProgramme.objects.filter(code=code).first()
        if code is not None and programme is None:
            raise CommandError(f"{username}: no programme {code!r}")
        StudentProgramme.declare(
            user, programme=programme, year_of_study=account.get("year_of_study")
        )

    def _role_row(self, user: User, role: dict[str, str]) -> RoleAssignment:
        """The role row the data file declares, not saved: `{"role": ..., "edition": "CODE:YEAR"}`
        for a teacher, `{"role": ..., "programme": "CODE"}` for secretariat staff."""
        try:
            if role["role"] == Role.TEACHER:
                code, year = role["edition"].split(":")
                edition = CourseEdition.objects.get(course__code=code, academic_year=year)
                return RoleAssignment(user=user, role=Role.TEACHER, edition=edition)
            if role["role"] == Role.SECRETARIAT:
                programme = DegreeProgramme.objects.get(code=role["programme"])
                return RoleAssignment(user=user, role=Role.SECRETARIAT, programme=programme)
        except (CourseEdition.DoesNotExist, DegreeProgramme.DoesNotExist, ValueError):
            raise CommandError(f"{user.username}: no scope {role}") from None
        raise CommandError(f"{user.username}: no role {role['role']!r}")


def _same(row: RoleAssignment, want: RoleAssignment) -> bool:
    return (row.role, row.programme, row.edition) == (want.role, want.programme, want.edition)
