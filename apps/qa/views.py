"""HTTP surface for question answering.

One endpoint, one method. The view's whole job is translation: a validated
request in, an `AskResponse` out, every engine failure mapped onto a status
code. Nothing here knows how routing, retrieval or generation work.

A debt this leaves for Stage 5 — **CSRF**: DRF's default `SessionAuthentication`
enforces CSRF only for a request that actually carries a session, so anonymous
calls (curl, and the SPA before login exists) work today. The moment a browser
has logged into `/admin/` on this origin its session cookie rides along, CSRF
becomes live, and a fetch without the token gets a 403. The login work is where
that has to be handled, not here.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.qa.engine import EngineUnavailableError, answer_question
from apps.qa.serializers import AskRequest

if TYPE_CHECKING:
    from rest_framework.request import Request

logger = logging.getLogger(__name__)

# Every 503 here is transient by construction: a stopped model server, an index
# another process is holding, a question still being answered. A minute is long
# enough that a retry is not simply requeued behind the same work.
RETRY_AFTER_SECONDS = 60


class AskView(APIView):
    """POST a question, get a grounded answer with its routing decision and
    the excerpts it was generated from (apps/qa/contract.py owns the shape)."""

    def post(self, request: Request) -> Response:
        payload = AskRequest(data=request.data)
        payload.is_valid(raise_exception=True)
        validated = payload.validated_data

        try:
            answered = answer_question(validated["question"], validated["locale"])
        except EngineUnavailableError as exc:
            # Returned rather than raised so the retry hint can ride along —
            # DRF's `Throttled` sets that header for a 429 and a 503 without one
            # leaves the caller nothing to back off against. The body keeps
            # DRF's `{"detail": ...}` shape; the engine already logged the cause,
            # and what reaches the caller is the message written for them.
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
                headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
            )

        return Response(answered.model_dump())
