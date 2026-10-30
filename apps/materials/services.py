"""Adding a material to an edition: the one way in, for an upload and for the import command.

The file is stored under its digest and the row added `queued`; its ingest is
queued once the row is committed (apps/materials/tasks.py), and a row whose
ingest the broker refuses is deleted again, with its file. The same bytes
already on the edition are refused with the row they are, decided by the
unique constraint in a savepoint of its own, so two uploads of one file at
once cannot both pass a check made first. On another edition they are a row
of their own, over the file already stored.
"""

from __future__ import annotations

import hashlib
from functools import partial
from pathlib import PurePath
from typing import TYPE_CHECKING, cast

import psycopg
from django.db import IntegrityError, transaction

from apps.materials.models import CourseMaterial, material_name, material_storage
from apps.materials.tasks import ingest_material

if TYPE_CHECKING:
    from celery import Task
    from django.core.files import File

    from apps.accounts.models import User
    from apps.catalog.models import CourseEdition


class MaterialExistsError(Exception):
    """The edition holds these bytes already, as `material`."""

    def __init__(self, material: CourseMaterial) -> None:
        super().__init__(material.pk)
        self.material = material


def digest_of(upload: File) -> str:
    """The SHA-256 of the file, read in chunks: an upload past Django's memory limit is on disk."""
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    return digest.hexdigest()


def create_material(
    edition: CourseEdition, upload: File, *, uploaded_by: User | None
) -> CourseMaterial:
    """Store `upload` and add its row to `edition`, its ingest queued for after the commit.

    Raises `MaterialExistsError` when the edition holds the same bytes. The
    file is written only when no row has stored it: rewriting it in place
    would truncate a file an ingest of another edition may be reading.
    """
    material = CourseMaterial(
        edition=edition,
        sha256=digest_of(upload),
        source_file=PurePath(upload.name or "").name,
        uploaded_by=uploaded_by,
    )
    name = material_name(material, "")
    if material_storage.exists(name):
        material.file.name = name
    else:
        material.file.save(name, upload, save=False)
    try:
        with transaction.atomic():
            material.save()
    except IntegrityError as exc:
        cause = exc.__cause__
        if not (
            isinstance(cause, psycopg.Error)
            and cause.diag.constraint_name == "materials_material_unique_bytes"
        ):
            raise
        raise MaterialExistsError(
            CourseMaterial.objects.get(edition=edition, sha256=material.sha256)
        ) from None
    transaction.on_commit(partial(_queue_ingest, material, name))
    return material


def _queue_ingest(material: CourseMaterial, name: str) -> None:
    """Queue a committed material's ingest, or take the row back if the broker refuses it.

    A row no task will ever take would wait `queued` for good, and hold its
    bytes against a second upload. Outside a transaction, as the view and
    the import command call `create_material`, this runs before it returns,
    so the error reaches the caller.
    """
    try:
        # Celery leaves `app.task` unannotated, so pyright sees the bare function.
        cast("Task", ingest_material).delay(material.pk)
    except Exception:
        material.delete()
        if not CourseMaterial.objects.filter(file=name).exists():
            material_storage.delete(name)
        raise
