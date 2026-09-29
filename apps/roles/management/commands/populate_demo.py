"""Fill the database with the demo: two real programmes, their courses in two years, and its staff.

    uv run python manage.py populate_demo                # demo_catalog.json, beside this file
    uv run python manage.py populate_demo --data <path>

A demo seed, as Saleor's `populatedb` and Zulip's `populate_db` are (outside
the repository), not an import path: the catalogue is entered in the admin. The
data file names its source and the rules it was transcribed by. The command
merges by natural key, so it runs again at any time, on an empty database or
on one holding rows of its own:

- A programme by code, a course by code, a curriculum entry by programme,
  curriculum and course, an edition by course and year: created when missing,
  never changed when present. Each new row passes `full_clean()` first, so the
  models' own rules — an AD code belongs to one course (apps/catalog/models.py)
  — stop a bad data file at the row that breaks them.
- A new edition is not current. A course with no current edition gets the data
  file's first year through `set_current()`, the one way to change it
  (docs/data-model.md, invariant 2); a course with one keeps it.
- Accounts: `demo-` ones only, and the file may name no other. A declared
  account's superuser flag and role rows are made the file's, rows it does not
  declare removed; a `demo-` account the file does not name keeps the account
  and loses its role rows, so the demo holds exactly the roles the file shows.
  An account outside `demo-` is never touched.
- Passwords: with `DEMO_PASSWORD` set (config/env.py), every declared account
  gets it, on every run. Without it a new account gets no usable password, and a
  declared account that already has a usable one stops the run: anyone may
  register, so a stranger could have taken `demo-admin` first, and this command
  would make them the superuser.

It all runs in one transaction, so a run that stops leaves nothing behind. Role
rows written here go through neither apps/roles/grants.py nor the admin, so the
command prints each one it adds or removes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.catalog.editions import set_current
from apps.catalog.models import Course, CourseEdition, CurriculumEntry, DegreeProgramme
from apps.roles.models import RoleAssignment
from apps.roles.registry import Role
from config.env import env

if TYPE_CHECKING:
    from django.core.management.base import CommandParser
    from django.db.models import Model

DATA = Path(__file__).with_name("demo_catalog.json")
PREFIX = "demo-"


class Command(BaseCommand):
    help = "Merge the demo catalogue and its demo- accounts into the database."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--data", type=Path, default=DATA, help="the data file (default: %(default)s)"
        )

    def handle(self, *args: object, data: Path, **options: object) -> None:
        demo = json.loads(data.read_text(encoding="utf-8"))
        secret = env.demo_password.get_secret_value() if env.demo_password is not None else ""
        password = secret or None
        self._check_accounts(demo["accounts"], password)
        self.created: dict[str, int] = {}
        with transaction.atomic():
            self._catalogue(demo)
            for account in demo["accounts"]:
                self._account(account, password)
            declared = [a["username"] for a in demo["accounts"]]
            undeclared = RoleAssignment.objects.filter(user__username__startswith=PREFIX).exclude(
                user__username__in=declared
            )
            for row in undeclared.select_related("user", "programme", "edition__course"):
                row.delete()
                self.stdout.write(f"removed role {row}")
        made = ", ".join(f"{count} {name}" for name, count in self.created.items()) or "nothing"
        self.stdout.write(f"created {made}")

    def _check_accounts(self, accounts: list[dict[str, Any]], password: str | None) -> None:
        """Refuse, before writing anything, an account this command must not take over."""
        strangers = [a["username"] for a in accounts if not a["username"].startswith(PREFIX)]
        if strangers:
            raise CommandError(f"the data file names accounts outside {PREFIX}: {strangers}")
        if password is not None:
            return
        names = [a["username"] for a in accounts]
        taken = [
            u.username for u in User.objects.filter(username__in=names) if u.has_usable_password()
        ]
        if taken:
            raise CommandError(
                f"{taken} already have a password of their own; set DEMO_PASSWORD to take "
                "them over, or delete them"
            )

    def _merge[M: Model](self, model: type[M], key: dict[str, Any], fields: dict[str, Any]) -> M:
        """The row `key` names, created with `fields` when there is none."""
        row = model._default_manager.filter(**key).first()
        if row is not None:
            return row
        row = model(**key, **fields)
        try:
            row.full_clean()
        except ValidationError as exc:
            raise CommandError(f"{model._meta.verbose_name} {row}: {exc.messages}") from None
        row.save()
        name = str(model._meta.verbose_name_plural)
        self.created[name] = self.created.get(name, 0) + 1
        return row

    def _catalogue(self, demo: dict[str, Any]) -> None:
        programmes = {
            p["code"]: self._merge(
                DegreeProgramme, {"code": p["code"]}, {"name": p["name"], "locale": p["locale"]}
            )
            for p in demo["programmes"]
        }
        for c in demo["courses"]:
            course = self._merge(
                Course, {"code": c["code"]}, {"name": c["name"], "locale": c["locale"]}
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
            editions = [
                self._merge(CourseEdition, {"course": course, "academic_year": year}, {})
                for year in demo["academic_years"]
            ]
            if not CourseEdition.objects.filter(course=course, is_current=True).exists():
                set_current(editions[0])

    def _account(self, account: dict[str, Any], password: str | None) -> None:
        username = account["username"]
        user = User.objects.filter(username=username).first() or User(username=username)
        if password is not None:
            user.set_password(password)
        elif user.pk is None:
            user.set_unusable_password()
        user.is_superuser = user.is_staff = account.get("superuser", False)
        user.is_active = True
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

    def _role_row(self, user: User, role: dict[str, str]) -> RoleAssignment:
        """The role row the data file declares, not saved: `{"role": ..., "edition": "CODE:YEAR"}`
        for a teacher, `{"role": ..., "programme": "CODE"}` for secretariat staff."""
        try:
            if role["role"] == Role.TEACHER:
                code, year = role["edition"].split(":")
                edition = CourseEdition.objects.get(course__code=code, academic_year=year)
                return RoleAssignment(user=user, role=Role.TEACHER, edition=edition)
            programme = DegreeProgramme.objects.get(code=role["programme"])
            return RoleAssignment(user=user, role=Role.SECRETARIAT, programme=programme)
        except (CourseEdition.DoesNotExist, DegreeProgramme.DoesNotExist):
            raise CommandError(f"{user.username}: no scope {role}") from None


def _same(row: RoleAssignment, want: RoleAssignment) -> bool:
    return (row.role, row.programme, row.edition) == (want.role, want.programme, want.edition)
