"""A material's ingest says where it is, ends ready or failed, and leaves the index consistent.

The task runs as the worker runs it, its body called in the test's process,
over rag's own parse, chunk and index steps: docling's converter is the stub
of tests/test_parse.py, the chunker counts words (tests/test_chunk.py), the
encoders are those of tests/test_index.py, and the index is an in-memory
Qdrant. What a failure leaves is counted in that index, by the material's digest.
"""

from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import timedelta
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import pytest
from celery.exceptions import SoftTimeLimitExceeded
from django.core.files.base import ContentFile
from django.utils import timezone
from qdrant_client import QdrantClient, models
from test_chunk import build_document, word_chunker
from test_index import StubDense, StubSparse
from test_parse import CLASSIC, StubConverter, encrypted_pdf

from apps.catalog.models import Course, CourseEdition
from apps.materials import tasks
from apps.materials.ingest import Pipeline
from apps.materials.models import CourseMaterial, MaterialFailure, MaterialStatus
from apps.materials.tasks import STALLED_AFTER, fail_stalled, ingest_material
from rag.chunk import Chunk
from rag.index import COLLECTION, ensure_collection
from rag.parse import parse_pdf

if TYPE_CHECKING:
    from collections.abc import Callable

    from docling.document_converter import DocumentConverter

pytestmark = pytest.mark.django_db

NAME = "01-Elettrostatica.pdf"
FIRST, SECOND = b"%PDF-1.7 first", b"%PDF-1.7 second"


@pytest.fixture
def edition() -> CourseEdition:
    course = Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")
    return CourseEdition.objects.create(course=course, academic_year="2025-2026")


@pytest.fixture
def qdrant() -> QdrantClient:
    client = QdrantClient(location=":memory:")
    ensure_collection(client, StubDense().dimension())
    return client


def upload(edition: CourseEdition, data: bytes, source_file: str = NAME) -> CourseMaterial:
    material = CourseMaterial(
        edition=edition, sha256=hashlib.sha256(data).hexdigest(), source_file=source_file
    )
    material.file.save("upload.pdf", ContentFile(data), save=False)
    material.save()
    return material


class Worker:
    """The pipeline the task loads, with a converter the test chooses per material."""

    def __init__(self, qdrant: QdrantClient, monkeypatch: pytest.MonkeyPatch) -> None:
        self.qdrant = qdrant
        self.converter = StubConverter(document=build_document())
        self.probe = False
        monkeypatch.setattr(tasks, "loaded_pipeline", self.pipeline)

    def pipeline(self) -> Pipeline:
        converters = {"classic": cast("DocumentConverter", self.converter)}
        parse = partial(parse_pdf, converters=converters, plan=None if self.probe else CLASSIC)
        return Pipeline(
            parse=parse,
            chunker=word_chunker(),
            dense=StubDense(),
            sparse=StubSparse(),
            client=self.qdrant,
        )

    def points(self, material: CourseMaterial) -> list[Chunk]:
        found, _ = self.qdrant.scroll(
            COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source_sha256", match=models.MatchValue(value=material.sha256)
                    )
                ]
            ),
            limit=100,
            with_payload=True,
        )
        return [Chunk.model_validate(point.payload) for point in found]


@pytest.fixture
def worker(qdrant: QdrantClient, monkeypatch: pytest.MonkeyPatch) -> Worker:
    return Worker(qdrant, monkeypatch)


def status_during(
    material: CourseMaterial, step: Callable[..., Any], seen: list[str]
) -> Callable[..., Any]:
    def noted(*args: Any, **kwargs: Any) -> Any:
        seen.append(CourseMaterial.objects.get(pk=material.pk).status)
        return step(*args, **kwargs)

    return noted


def test_an_ingest_says_each_step_and_ends_ready_with_its_points(
    edition: CourseEdition, worker: Worker, monkeypatch: pytest.MonkeyPatch
) -> None:
    material = upload(edition, FIRST)
    seen: list[str] = []
    pipeline = worker.pipeline()
    noting = replace(pipeline, parse=status_during(material, pipeline.parse, seen))
    monkeypatch.setattr(tasks, "loaded_pipeline", lambda: noting)
    monkeypatch.setattr(
        tasks, "chunk_document", status_during(material, tasks.chunk_document, seen)
    )
    monkeypatch.setattr(tasks, "index_chunks", status_during(material, tasks.index_chunks, seen))

    ingest_material(material.pk)

    material.refresh_from_db()
    assert seen == [MaterialStatus.PARSING, MaterialStatus.CHUNKING, MaterialStatus.INDEXING]
    assert (material.status, material.failure) == (MaterialStatus.READY, "")
    assert material.started_at is not None
    assert material.finished_at is not None
    points = worker.points(material)
    assert points
    # The edition crosses into rag as two strings, and the card shows the uploaded name.
    assert {(p.course, p.academic_year, p.source_file) for p in points} == {
        ("B028451", "2025-2026", NAME)
    }


@pytest.mark.parametrize(
    ("converter", "probe", "failure"),
    [
        pytest.param(None, True, MaterialFailure.UNREADABLE, id="encrypted"),
        pytest.param(
            StubConverter("partial_success"), False, MaterialFailure.INCOMPLETE, id="truncated"
        ),
        pytest.param(StubConverter(), False, MaterialFailure.UNREADABLE, id="no-text"),
        pytest.param(
            StubConverter(error=SoftTimeLimitExceeded()),
            False,
            MaterialFailure.INTERRUPTED,
            id="past-its-time",
        ),
        pytest.param(
            StubConverter(error=RuntimeError("CUDA out of memory")),
            False,
            MaterialFailure.INTERNAL,
            id="the-server",
        ),
    ],
)
def test_a_failed_ingest_says_why_and_leaves_no_point(
    edition: CourseEdition,
    worker: Worker,
    converter: StubConverter | None,
    probe: bool,
    failure: MaterialFailure,
) -> None:
    material = upload(edition, encrypted_pdf() if probe else FIRST)
    worker.converter = converter or worker.converter
    worker.probe = probe

    ingest_material(material.pk)

    material.refresh_from_db()
    assert (material.status, material.failure) == (MaterialStatus.FAILED, failure)
    assert material.finished_at is not None
    assert worker.points(material) == []


class LosesItsDeletes:
    """The index, until its first delete: the one that would drop the older points."""

    def __init__(self, client: QdrantClient) -> None:
        self.client = client
        self.failed = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.client, name)

    def delete(self, *args: Any, **kwargs: Any) -> Any:
        if not self.failed:
            self.failed = True
            raise ConnectionError("Qdrant went away")
        return self.client.delete(*args, **kwargs)


def test_a_failure_after_the_points_were_written_takes_them_back(
    edition: CourseEdition, worker: Worker, qdrant: QdrantClient
) -> None:
    material = upload(edition, FIRST)
    worker.qdrant = cast("QdrantClient", LosesItsDeletes(qdrant))

    ingest_material(material.pk)

    material.refresh_from_db()
    assert (material.status, material.failure) == (MaterialStatus.FAILED, MaterialFailure.INTERNAL)
    assert worker.points(material) == []


def test_a_new_version_replaces_the_old_once_it_is_ready(
    edition: CourseEdition, worker: Worker
) -> None:
    old = upload(edition, FIRST)
    ingest_material(old.pk)
    # The same bytes on another edition keep the file on disk.
    other = CourseEdition.objects.create(course=edition.course, academic_year="2026-2027")
    shared = upload(other, FIRST)
    new = upload(edition, SECOND)

    ingest_material(new.pk)

    assert list(CourseMaterial.objects.filter(edition=edition)) == [new]
    assert worker.points(old) == []
    assert worker.points(new)
    assert Path(shared.file.path).is_file()


def test_the_last_version_takes_its_files_with_it(edition: CourseEdition, worker: Worker) -> None:
    old = upload(edition, FIRST)
    ingest_material(old.pk)
    new = upload(edition, SECOND)

    ingest_material(new.pk)

    assert not Path(old.file.path).exists()
    assert Path(new.file.path).is_file()


def test_a_new_version_that_fails_leaves_the_old_one_answering(
    edition: CourseEdition, worker: Worker
) -> None:
    old = upload(edition, FIRST)
    ingest_material(old.pk)
    answering = worker.points(old)
    new = upload(edition, SECOND)
    worker.converter = StubConverter("partial_success")

    ingest_material(new.pk)

    old.refresh_from_db()
    assert old.status == MaterialStatus.READY
    assert worker.points(old) == answering
    assert CourseMaterial.objects.get(pk=new.pk).failure == MaterialFailure.INCOMPLETE


def test_a_newer_version_waiting_in_the_queue_is_not_replaced(
    edition: CourseEdition, worker: Worker
) -> None:
    """Ingested out of order, as a redelivery could: only older rows go."""
    old, new = upload(edition, FIRST), upload(edition, SECOND)

    ingest_material(old.pk)

    assert set(CourseMaterial.objects.filter(edition=edition)) == {old, new}


@pytest.mark.parametrize("state", ["deleted", "ready"])
def test_a_material_gone_or_ready_is_not_ingested_again(
    edition: CourseEdition, worker: Worker, state: str
) -> None:
    material = upload(edition, FIRST)
    if state == "deleted":
        material.delete()
    else:
        CourseMaterial.objects.filter(pk=material.pk).update(status=MaterialStatus.READY)

    ingest_material(material.pk)

    assert worker.converter.calls == 0


def test_a_material_deleted_while_it_was_indexed_leaves_no_point(
    edition: CourseEdition, worker: Worker, monkeypatch: pytest.MonkeyPatch
) -> None:
    material = upload(edition, FIRST)
    index = tasks.index_chunks

    def index_then_delete(*args: Any, **kwargs: Any) -> int:
        written = index(*args, **kwargs)
        CourseMaterial.objects.filter(pk=material.pk).delete()
        return written

    monkeypatch.setattr(tasks, "index_chunks", index_then_delete)

    ingest_material(material.pk)

    assert worker.points(material) == []


def test_the_sweep_fails_what_lost_its_worker_and_nothing_else(edition: CourseEdition) -> None:
    now = timezone.now()
    long_ago, lately = now - STALLED_AFTER - timedelta(minutes=1), now - timedelta(minutes=5)
    rows = {
        "lost": (MaterialStatus.INDEXING, long_ago),
        "running": (MaterialStatus.PARSING, lately),
        "queued": (MaterialStatus.QUEUED, None),
        "done": (MaterialStatus.READY, long_ago),
    }
    materials = {
        key: CourseMaterial.objects.create(
            edition=edition,
            sha256=hashlib.sha256(key.encode()).hexdigest(),
            source_file=f"{key}.pdf",
            status=status,
            started_at=started,
        )
        for key, (status, started) in rows.items()
    }

    assert fail_stalled() == 1

    after = {key: CourseMaterial.objects.get(pk=row.pk) for key, row in materials.items()}
    assert (after["lost"].status, after["lost"].failure) == (
        MaterialStatus.FAILED,
        MaterialFailure.INTERRUPTED,
    )
    assert {key: row.status for key, row in after.items() if key != "lost"} == {
        key: status for key, (status, _started) in rows.items() if key != "lost"
    }


def test_the_ingest_has_a_queue_and_limits_of_its_own() -> None:
    """Over the five-minute default, under the broker's hour (config/settings.py)."""
    # Celery leaves `app.task` unannotated, and its stubs name neither attribute.
    task: Any = ingest_material
    assert task.queue == "ingest"
    assert task.soft_time_limit < task.time_limit < 60 * 60
