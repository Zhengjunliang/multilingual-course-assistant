"""Serving the PDF a slides citation came from.

Separate from apps/qa/conversation_views.py: those endpoints read rows the
caller owns and answer to ownership, this one hands out a course material's
file and answers to the material table (apps/materials/models.py).
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from django.http import FileResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.materials.models import CourseMaterial, MaterialStatus
from config.errors import ErrorCode, fail

if TYPE_CHECKING:
    from rest_framework.request import Request


class SourceView(APIView):
    """The whole PDF, inline, so the browser's own viewer opens it at `#page=N`.

    That is how Open WebUI and Onyx open a cited file: by id, behind a login, in
    the browser's viewer rather than one shipped with the page. Any logged-in
    account may read it (docs/decisions.md, 2026-09-29, *A slides citation opens
    its whole PDF, and a conversation is deleted outright*).

    The key is the `source_sha256` a slides citation carries
    (apps/qa/contract.py), which is the digest of a material's bytes, and the
    file is the one a `ready` material with that digest names. The path is the
    storage's, built from the digest, never from anything the client sends. A
    material still being ingested, or failed, is not served: no citation can
    name it yet. The same bytes on two editions are one file, served under the
    name of the newer row.

    Every miss is a 404: a sha256 names content, and a 404 does not confirm the
    content exists. The URL admits only 64 lower-case hex digits
    (apps/qa/urls.py), so anything else never reaches this view.

    No `Content-Security-Policy: sandbox`: Chromium does not render a PDF in a
    sandboxed document. `ETag` is the digest, and nothing answers a
    conditional request with a 304 — there is no ConditionalGetMiddleware.
    """

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, sha256: str) -> FileResponse:
        material = CourseMaterial.objects.filter(sha256=sha256, status=MaterialStatus.READY).first()
        if material is None:
            fail(ErrorCode.NOT_FOUND)
        path = Path(material.file.path)
        try:
            handle = path.open("rb")
        except OSError:
            # A row whose file is gone or locked: a miss like any other.
            fail(ErrorCode.NOT_FOUND)
        response = FileResponse(
            handle,
            content_type="application/pdf",
            as_attachment=False,
            filename=material.source_file,
        )
        response["Cache-Control"] = "private"
        response["ETag"] = f'"{sha256}"'
        return response
