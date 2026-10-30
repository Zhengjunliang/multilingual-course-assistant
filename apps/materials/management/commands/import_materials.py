"""Add the PDFs of a directory to a course edition, as if each were uploaded.

    uv run python manage.py import_materials data/corpus/PPM --course B028451 --academic-year <year>

How the decks parsed from the command line (docs/development.md, "The
pipeline CLI") become materials, and how a course's files can be added
without the site. Each PDF, found as `rag.parse` finds them, goes through
`create_material`, the upload's own way in (apps/materials/services.py), with
nobody as its uploader: the same bytes on the edition are skipped, a name
the edition holds is that material's next version, and every other file is a
new material, its ingest queued for the worker. The points a deck parsed from
the command line left in the index go once its material is ready, replaced
by name (`rag.index.replace_slides_sources`).

Not one transaction: each material is committed, and its ingest queued, as
it is added, so a run that stops has queued what it reached, and runs again
skipping it.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from apps.catalog.models import CourseEdition
from apps.materials.services import MaterialExistsError, create_material
from rag.probe import collect_pdfs

if TYPE_CHECKING:
    from django.core.management.base import CommandParser


class Command(BaseCommand):
    help = "Add the PDFs of a directory to a course edition and queue their ingest."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("target", type=Path, help="a PDF, or a directory searched for them")
        parser.add_argument("--course", required=True, help="the course code, e.g. B028451")
        parser.add_argument(
            "--academic-year", required=True, help="the edition's year, e.g. 2025-2026"
        )

    def handle(
        self, *args: object, target: Path, course: str, academic_year: str, **options: object
    ) -> None:
        if not target.exists():
            raise CommandError(f"{target} does not exist")
        edition = CourseEdition.objects.filter(
            course__code=course, academic_year=academic_year
        ).first()
        if edition is None:
            raise CommandError(f"no edition of {course} in {academic_year}")
        pdfs = list(collect_pdfs(target))
        # Two files of one name would be two versions of one material, and the
        # first would be replaced by the second.
        names = Counter(pdf.name for pdf in pdfs)
        if twice := sorted(name for name, count in names.items() if count > 1):
            raise CommandError(f"more than one file named {', '.join(twice)}")
        queued = skipped = 0
        for pdf in pdfs:
            with pdf.open("rb") as handle:
                try:
                    material = create_material(
                        edition, File(handle, name=pdf.name), uploaded_by=None
                    )
                except MaterialExistsError as exc:
                    skipped += 1
                    self.stdout.write(f"skipped {pdf.name}: material {exc.material.pk}")
                    continue
            queued += 1
            self.stdout.write(f"queued {pdf.name} as material {material.pk}")
        self.stdout.write(f"{edition}: {queued} queued, {skipped} already there")
