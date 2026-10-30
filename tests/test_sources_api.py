"""`GET /api/sources/<sha256>`: the PDF a slides citation came from.

A material is written as the upload writes it, its file stored under its
digest in the run's own `MATERIALS_ROOT` (tests/conftest.py), with the status
the test needs, so nothing here reads the developer's material.

Every response is closed: a `FileResponse` holds its file open, and the
suite's `filterwarnings = error` turns the unclosed handle into a failure.
"""

import hashlib
from pathlib import Path
from typing import Any

import pytest
from django.core.files.base import ContentFile
from test_qa_api import client_for

from apps.catalog.models import Course, CourseEdition
from apps.materials.models import CourseMaterial, MaterialFailure, MaterialStatus

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n% a course deck\n%%EOF\n"
SHA = hashlib.sha256(PDF).hexdigest()


def stored(
    edition: CourseEdition,
    data: bytes = PDF,
    *,
    name: str = "deck (2).pdf",
    status: MaterialStatus = MaterialStatus.READY,
    failure: str = "",
) -> CourseMaterial:
    """A material of `edition` holding `data`, its ingest at `status`."""
    material = CourseMaterial(
        edition=edition,
        sha256=hashlib.sha256(data).hexdigest(),
        source_file=name,
        status=status,
        failure=failure,
    )
    material.file.save("upload.pdf", ContentFile(data), save=False)
    material.save()
    return material


def read(response: Any) -> bytes:
    """Every byte of a file response, which is then closed.

    `Any` as in tests/test_qa_api.py: the test client's response type does not
    declare `streaming_content`.
    """
    try:
        return b"".join(response.streaming_content)
    finally:
        response.close()


@pytest.fixture
def edition() -> CourseEdition:
    course = Course.objects.create(code="B028451", name="Progettazione e Produzione Multimediale")
    return CourseEdition.objects.create(course=course, academic_year="2025-2026")


def test_a_ready_material_opens_inline_under_its_uploaded_name(edition: CourseEdition) -> None:
    stored(edition)

    response = client_for().get(f"/api/sources/{SHA}")
    body = read(response)

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"].startswith("inline")
    assert "deck (2).pdf" in response["Content-Disposition"]
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Cache-Control"] == "private"
    assert response["ETag"] == f'"{SHA}"'
    assert "Content-Security-Policy" not in response
    assert body == PDF


@pytest.mark.parametrize(
    ("sha", "status", "failure"),
    [
        pytest.param("0" * 64, MaterialStatus.READY, "", id="unknown-sha"),
        pytest.param(SHA.upper(), MaterialStatus.READY, "", id="uppercase-hex"),
        pytest.param(SHA, MaterialStatus.INDEXING, "", id="still-ingested"),
        pytest.param(SHA, MaterialStatus.FAILED, MaterialFailure.INCOMPLETE, id="failed"),
    ],
)
def test_a_source_is_not_found(
    edition: CourseEdition, sha: str, status: MaterialStatus, failure: str
) -> None:
    stored(edition, status=status, failure=failure)

    response = client_for().get(f"/api/sources/{sha}")
    response.close()

    assert response.status_code == 404


def test_a_material_whose_file_is_gone_is_not_found(edition: CourseEdition) -> None:
    gone = b"%PDF-1.4\n% deleted by hand\n%%EOF\n"
    material = stored(edition, gone)
    Path(material.file.path).unlink()

    response = client_for().get(f"/api/sources/{material.sha256}")
    response.close()

    assert response.status_code == 404
