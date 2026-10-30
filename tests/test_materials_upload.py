"""An upload's limits (#36): its bytes, its content, its pages, its name on disk and its rate.

Sent as tests/test_content_api.py sends one, by the teacher of `world()`
(tests/test_roles.py), into the run's own `MATERIALS_ROOT` (tests/conftest.py),
which every test of the run shares: what a refusal leaves there is compared
with what was there before. The ingest is never run.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

import pytest
from django.http.multipartparser import MultiPartParser
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle
from test_catalog_api import as_user, code_of
from test_content_api import materials, upload
from test_parse import blank_pdf, encrypted_pdf
from test_roles import world

from apps.materials.models import CourseMaterial, material_storage
from apps.materials.services import MAX_PDF_PAGES, MAX_UPLOAD_BYTES

if TYPE_CHECKING:
    from django.http.response import HttpResponseBase

pytestmark = pytest.mark.django_db


def stored() -> set[str]:
    return set(material_storage.listdir("")[1])


def fields_of(response: HttpResponseBase) -> list[tuple[str, str, dict[str, object]]]:
    """A 400's rejected fields, each with its reason and the values its sentence fills in."""
    error = response.json()["error"]  # pyright: ignore[reportAttributeAccessIssue]
    return [(v["field"], v["reason"], v["data"]) for v in error["fields"]]


def test_rejects_oversize_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """Refused on its length, before the CSRF check of authentication parses the body.

    The client checks CSRF as a browser's request is checked, so a body read
    there would be a 403; a body parsed anywhere fails the test.
    """
    w = world()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(w.newcomer)
    data = b"%PDF-1.7\n" + bytes(MAX_UPLOAD_BYTES)
    before = stored()

    def parsed(*args: object) -> None:
        pytest.fail("the body was parsed")

    monkeypatch.setattr(MultiPartParser, "parse", parsed)

    response = upload(client, w.ppm_new, data)

    error = response.json()["error"]  # pyright: ignore[reportAttributeAccessIssue]
    assert (response.status_code, error["code"], error["data"]) == (
        413,
        "CONTENT_TOO_LARGE",
        {"max_mib": 50},
    )
    assert stored() == before
    assert not CourseMaterial.objects.exists()


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"PK\x03\x04\x14\x00 an archive named .pdf", id="another-format"),
        pytest.param(b"%PDF-1.7\n% a signature and nothing else\n", id="a-signature-alone"),
    ],
)
def test_rejects_a_renamed_non_pdf(data: bytes) -> None:
    """By its content, whatever its name and media type say (OWASP's File Upload Cheat Sheet)."""
    w = world()
    before = stored()

    response = upload(as_user(w.newcomer), w.ppm_new, data)

    assert (response.status_code, fields_of(response)) == (400, [("file", "INVALID", {})])
    assert stored() == before
    assert not CourseMaterial.objects.exists()


def test_rejects_too_many_pages() -> None:
    """Refused whole: a deck cut short would miss its last chapters with nobody told."""
    w = world()
    client = as_user(w.newcomer)

    longest = upload(client, w.ppm_new, blank_pdf(MAX_PDF_PAGES, title="longest"))
    over = upload(client, w.ppm_new, blank_pdf(MAX_PDF_PAGES + 1), name="02-Lungo.pdf")

    assert longest.status_code == 202
    assert (over.status_code, fields_of(over)) == (
        400,
        [("file", "TOO_MANY_PAGES", {"max_pages": MAX_PDF_PAGES})],
    )
    assert CourseMaterial.objects.count() == 1


def test_stored_name_is_derived() -> None:
    """The name a file was sent under is shown, and never a path on the server."""
    w = world()
    data = blank_pdf(title="passwd")
    digest = hashlib.sha256(data).hexdigest()

    response = upload(as_user(w.newcomer), w.ppm_new, data, name="../../etc/passwd.pdf")

    material = CourseMaterial.objects.get()
    assert response.status_code == 202
    assert (material.file.name, material.source_file) == (f"{digest}.pdf", "passwd.pdf")
    assert material_storage.exists(f"{digest}.pdf")


def test_upload_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Past the bucket a `POST` is a 429, and listing, which the page does while an ingest
    runs, neither counts nor is refused. The rate is lowered here; config/settings.py sets it."""
    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "upload", "2/hour")
    w = world()
    client = as_user(w.newcomer)

    def send(index: int) -> int:
        return upload(
            client, w.ppm_new, blank_pdf(title=str(index)), name=f"{index}.pdf"
        ).status_code

    def listed() -> int:
        return client.get(materials(w.ppm_new)).status_code

    codes = [send(1), listed(), listed(), send(2), listed(), listed()]
    third = upload(client, w.ppm_new, blank_pdf(title="3"), name="3.pdf")

    assert codes == [202, 200, 200, 202, 200, 200]
    assert (third.status_code, code_of(third)) == (429, "RESOURCE_EXHAUSTED")
    assert listed() == 200
    assert CourseMaterial.objects.count() == 2


def test_an_upload_of_a_locked_pdf_is_taken_for_its_ingest_to_fail() -> None:
    """Its pages cannot be counted without the password, and docling cannot read it either:
    the ingest marks it `unreadable` (tests/test_materials_tasks.py)."""
    w = world()

    response = upload(as_user(w.newcomer), w.ppm_new, encrypted_pdf())

    assert response.status_code == 202
