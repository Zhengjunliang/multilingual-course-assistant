"""`manage.py import_materials`: a directory's PDFs added to an edition as uploads are.

The files are written under tmp_path and stored in the run's own
`MATERIALS_ROOT` (tests/conftest.py); the ingest is not run, only counted as
queued once each row is committed, as tests/test_content_api.py counts an upload's.
"""

from __future__ import annotations

from io import StringIO
from typing import TYPE_CHECKING, Any

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.catalog.models import Course, CourseEdition
from apps.materials.models import CourseMaterial, MaterialStatus
from apps.materials.tasks import ingest_material

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.django_db


@pytest.fixture
def edition() -> CourseEdition:
    course = Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")
    return CourseEdition.objects.create(course=course, academic_year="2025-2026")


def run(target: Path, year: str = "2025-2026") -> str:
    out = StringIO()
    call_command("import_materials", str(target), course="B028451", academic_year=year, stdout=out)
    return out.getvalue()


def test_each_pdf_is_added_once_and_its_ingest_queued_after_the_commit(
    edition: CourseEdition,
    tmp_path: Path,
    django_capture_on_commit_callbacks: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A nested `.PDF` is found as `rag.parse` finds it; anything else is not a material."""
    (tmp_path / "01-Intro.pdf").write_bytes(b"%PDF-1.7 intro")
    (tmp_path / "topic").mkdir()
    (tmp_path / "topic" / "02-Django.PDF").write_bytes(b"%PDF-1.7 django")
    (tmp_path / "notes.txt").write_text("not a deck", encoding="utf-8")
    queued: list[int] = []
    monkeypatch.setattr(ingest_material, "delay", queued.append)

    with django_capture_on_commit_callbacks(execute=True):
        first = run(tmp_path)
    with django_capture_on_commit_callbacks(execute=True):
        again = run(tmp_path)

    materials = CourseMaterial.objects.order_by("pk")
    assert [(m.source_file, m.status, m.uploaded_by) for m in materials] == [
        ("01-Intro.pdf", MaterialStatus.QUEUED, None),
        ("02-Django.PDF", MaterialStatus.QUEUED, None),
    ]
    assert queued == [m.pk for m in materials]
    assert first.endswith("B028451:2025-2026: 2 queued, 0 already there\n")
    assert again.endswith("B028451:2025-2026: 0 queued, 2 already there\n")


def test_two_files_of_one_name_stop_the_run_before_either_is_added(
    edition: CourseEdition, tmp_path: Path
) -> None:
    """In one run they would be two versions of one material, and the first would be lost."""
    for topic in ("html", "css"):
        (tmp_path / topic).mkdir()
        (tmp_path / topic / "esercizi.pdf").write_bytes(f"%PDF-1.7 {topic}".encode())

    with pytest.raises(CommandError, match=r"esercizi\.pdf"):
        run(tmp_path)

    assert not CourseMaterial.objects.exists()


def test_an_edition_that_does_not_exist_stops_the_run(
    edition: CourseEdition, tmp_path: Path
) -> None:
    (tmp_path / "01-Intro.pdf").write_bytes(b"%PDF-1.7 intro")

    with pytest.raises(CommandError, match="no edition of B028451 in 2024-2025"):
        run(tmp_path, year="2024-2025")

    assert not CourseMaterial.objects.exists()
