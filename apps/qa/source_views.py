"""Serving the PDF a slides citation came from.

Separate from apps/qa/conversation_views.py: those endpoints read rows the
caller owns and answer to ownership, this one hands out a corpus file and
answers to the corpus directory (apps/qa/sources.py).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.http import FileResponse, Http404
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.qa.sources import source_pdf

if TYPE_CHECKING:
    from rest_framework.request import Request


class SourceView(APIView):
    """The whole PDF, inline, so the browser's own viewer opens it at `#page=N`.

    That is how Open WebUI and Onyx open a cited file: by id, behind a login, in
    the browser's viewer rather than one shipped with the page. Any logged-in
    account may read it (docs/decisions.md, 2026-09-29, *A slides citation opens
    its whole PDF, and a conversation is deleted outright*).

    Every miss is a 404, a key a sidecar points outside the corpus included: a
    sha256 names content, and a 404 does not confirm the content exists. The URL
    admits only 64 lower-case hex digits (apps/qa/urls.py), so anything else
    never reaches this view.

    No `Content-Security-Policy: sandbox`: Chromium does not render a PDF in a
    sandboxed document. `ETag` is the recorded sha, and nothing answers a
    conditional request with a 304 — there is no ConditionalGetMiddleware.
    """

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, sha256: str) -> FileResponse:
        path = source_pdf(sha256)
        if path is None:
            raise Http404
        try:
            handle = path.open("rb")
        except OSError:
            # Gone or locked since `source_pdf` looked: a miss like any other.
            raise Http404 from None
        response = FileResponse(
            handle,
            content_type="application/pdf",
            as_attachment=False,
            filename=path.name,
        )
        response["Cache-Control"] = "private"
        response["ETag"] = f'"{sha256}"'
        return response
