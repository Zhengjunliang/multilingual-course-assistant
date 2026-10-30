"""Course material's background tasks: the ingest of one material, and the sweep for lost ones.

**The ingest** runs on the `ingest` queue, one material at a time per worker
(docs/background-tasks.md), queued once the material's row is committed. It
writes each step into the row as it reaches it — `parsing`, `chunking`,
`indexing` — and ends at `ready` or at `failed` with a code
(apps/materials/models.py). A failure leaves no point of the material behind:
the points are written only once every chunk is embedded (`upsert_chunks`),
and whatever was written goes again by the material's own key
(`delete_material`), so an older version under the same name keeps answering.

**A new version** replaces its predecessors once it is ready, and not
before: then the points of its name it did not write are deleted
(`rag.index.replace_slides_sources`), and the older rows go, with any file
no other row still names. A delete the index refuses, or a worker killed
before it, leaves both versions answering until the next version replaces them. The order between
two versions is the queue's: ingest takes one material at a time, first in
first out.

**Twice is harmless.** A task acknowledged late is delivered again if its
worker dies (config/settings.py): it starts over, writing the same points
under the same ids, and a material already `ready` is left alone. A row
deleted while it waited, or while it was ingested, stops the ingest at the
next step, and what was indexed goes with it.

**The sweep.** A worker that dies under a material leaves its row in a
running state for good. `fail_stalled`, every ten minutes from beat, marks
such a row `interrupted` once it has run past the hard time limit with a
margin, as Onyx's beat sweeps its indexing attempts (outside the repository).
A worker killed after the upsert and before the row moved on would leave its
points; the window is the few milliseconds between two writes, and is left open.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from celery.exceptions import SoftTimeLimitExceeded
from django.db import transaction
from django.utils import timezone

from apps.materials.ingest import loaded_pipeline
from apps.materials.models import (
    CourseMaterial,
    MaterialFailure,
    MaterialStatus,
    material_storage,
)
from config.celery import app
from rag.chunk import EditionKey, chunk_document, document_locale
from rag.index import delete_material, replace_slides_sources, upsert_chunks
from rag.parse import IncompletePdfError, UnreadablePdfError

if TYPE_CHECKING:
    from qdrant_client import QdrantClient

    from apps.materials.ingest import Pipeline

logger = logging.getLogger(__name__)

# A deck takes about thirty seconds on the laptop's GPU, a long scan under
# OCR a few minutes; past twenty the task is stopped, and five later killed.
# Both stay under the broker's visibility timeout, an hour on Redis, and the
# solo pool of a Windows worker enforces neither (config/settings.py).
SOFT_TIME_LIMIT_SECONDS = 20 * 60
TIME_LIMIT_SECONDS = 25 * 60

# A row still running this long after it started has lost its worker: past
# the hard limit, which kills the task, by a margin for a clock that is behind.
STALLED_AFTER = timedelta(seconds=TIME_LIMIT_SECONDS + 5 * 60)

RUNNING = (MaterialStatus.PARSING, MaterialStatus.CHUNKING, MaterialStatus.INDEXING)

# Failures that are the file's, not the server's: logged without alarm.
_THE_FILES = (MaterialFailure.UNREADABLE, MaterialFailure.INCOMPLETE)


@app.task(queue="ingest", soft_time_limit=SOFT_TIME_LIMIT_SECONDS, time_limit=TIME_LIMIT_SECONDS)
def ingest_material(material_id: int) -> None:
    """Parse, chunk and index one material, writing each step into its row."""
    material = (
        CourseMaterial.objects.select_related("edition__course").filter(pk=material_id).first()
    )
    if material is None or material.status == MaterialStatus.READY:
        return
    edition = EditionKey(material.edition.course.code, material.edition.academic_year)
    pipeline: Pipeline | None = None
    try:
        # From the start, whatever an earlier delivery left in the row.
        if not _move(
            material,
            MaterialStatus.PARSING,
            failure="",
            started_at=timezone.now(),
            finished_at=None,
        ):
            return
        pipeline = loaded_pipeline()
        parsed = pipeline.parse(
            Path(material.file.path),
            course=edition.course,
            academic_year=edition.academic_year,
            source_file=material.source_file,
        )
        if not _move(material, MaterialStatus.CHUNKING):
            return
        locale = document_locale(parsed.document, parsed.meta)
        chunks = chunk_document(parsed.document, pipeline.chunker, parsed.meta, locale)
        if not chunks:
            # A scan with nothing recognised in it: nothing a question could find.
            raise UnreadablePdfError(f"{material.source_file}: no text")
        if not _move(material, MaterialStatus.INDEXING):
            return
        written = upsert_chunks(pipeline.client, chunks, pipeline.dense, pipeline.sparse)
        if not _move(material, MaterialStatus.READY, finished_at=timezone.now()):
            # Deleted while it was indexed: what was written goes with it.
            delete_material(pipeline.client, material.sha256, edition)
            return
    except Exception as exc:
        _fail(material, edition, pipeline, exc)
        return
    _replace_older(material, edition, pipeline.client, written)


@app.task
def fail_stalled() -> int:
    """Mark `interrupted` the rows whose worker died under them; how many."""
    now = timezone.now()
    stalled = CourseMaterial.objects.filter(
        status__in=RUNNING, started_at__lt=now - STALLED_AFTER
    ).update(status=MaterialStatus.FAILED, failure=MaterialFailure.INTERRUPTED, finished_at=now)
    if stalled:
        logger.warning("%d material ingest(s) lost their worker, marked failed", stalled)
    return stalled


def _move(material: CourseMaterial, status: MaterialStatus, **fields: Any) -> bool:
    """Write the step the ingest has reached; False when the row is gone."""
    return CourseMaterial.objects.filter(pk=material.pk).update(status=status, **fields) == 1


def _replace_older(
    material: CourseMaterial, edition: EditionKey, client: QdrantClient, written: list[str]
) -> None:
    """Delete the older versions under a ready material's name: their points, rows and files.

    Older by key, which the database hands out in upload order: a newer
    version waiting behind this one in the queue is not touched. A file is
    deleted when no row names it any more, since another edition may hold the
    same bytes.
    """
    try:
        replace_slides_sources(client, [(material.source_file, edition)], written)
    except Exception:
        logger.exception("material %d: the older versions' points stay", material.pk)
        return
    with transaction.atomic():
        older = CourseMaterial.objects.filter(
            edition_id=material.edition_id, source_file=material.source_file, pk__lt=material.pk
        )
        names = list(older.values_list("file", flat=True))
        older.delete()
    for name in names:
        if CourseMaterial.objects.filter(file=name).exists():
            continue
        try:
            material_storage.delete(name)
        except OSError:
            # Windows refuses to delete a file open elsewhere, one being served say.
            logger.exception("material %d: the file %s stays", material.pk, name)


def _fail(
    material: CourseMaterial, edition: EditionKey, pipeline: Pipeline | None, exc: Exception
) -> None:
    """Delete what the ingest wrote, then mark the row failed with the code `exc` maps to."""
    failure = _failure_of(exc)
    if failure in _THE_FILES:
        logger.warning("material %d: %s", material.pk, failure, exc_info=exc)
    else:
        logger.error("material %d: ingest %s", material.pk, failure, exc_info=exc)
    # No pipeline, no point written: the failure was building it.
    if pipeline is not None:
        try:
            delete_material(pipeline.client, material.sha256, edition)
        except Exception:
            logger.exception("material %d: its points could not be deleted", material.pk)
    CourseMaterial.objects.filter(pk=material.pk).update(
        status=MaterialStatus.FAILED, failure=failure, finished_at=timezone.now()
    )


def _failure_of(exc: Exception) -> MaterialFailure:
    if isinstance(exc, UnreadablePdfError):
        return MaterialFailure.UNREADABLE
    if isinstance(exc, IncompletePdfError):
        return MaterialFailure.INCOMPLETE
    if isinstance(exc, SoftTimeLimitExceeded):
        return MaterialFailure.INTERRUPTED
    return MaterialFailure.INTERNAL
