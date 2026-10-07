"""Error bodies that name each refusal with a code a page can translate.

DRF's default handler answers with its usual envelope — `{"detail": ...}` for a
refusal of the whole request, `{"<field>": [...]}` for rejected fields — whose
leaves are sentences: English where this project wrote them, in the request's
language where DRF did (docs/decisions.md, 2026-08-27, *Backend messages
have no gettext catalogue and stay English*). A page cannot translate a
sentence, so `full_details_handler` keeps the envelope and turns every leaf
into `{"message": ..., "code": ...}`, the shape DRF's own `get_full_details()`
gives, as its documentation shows for custom exception handlers: call the
default handler first, then change the data of the response it built.

Only views that mix in `CodedErrors` answer this way (the staff endpoints:
apps/roles/api.py, apps/catalog/views.py); the rest of the API keeps plain
sentences until one error contract covers every endpoint, which is #143's.
`ApiError` (frontend/src/api/http.ts) reads both shapes until then.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from rest_framework.exceptions import ErrorDetail
from rest_framework.views import exception_handler

if TYPE_CHECKING:
    from collections.abc import Callable

    from rest_framework.response import Response


def _full_details(data: Any) -> Any:
    if isinstance(data, ErrorDetail):
        return {"message": str(data), "code": data.code}
    if isinstance(data, dict):
        return {key: _full_details(value) for key, value in data.items()}
    if isinstance(data, list):
        return [_full_details(item) for item in data]
    return data


def full_details_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """DRF's default answer to `exc`, each message in it with its code.

    The details are read from the response the default handler built, not
    from `exc`: that handler turns Django's `Http404` and `PermissionDenied`
    into DRF's exceptions only inside itself, and they carry no details of
    their own. An exception it does not handle stays unhandled, a 500.
    """
    response = exception_handler(exc, context)
    if response is not None:
        response.data = _full_details(response.data)
    return response


class CodedErrors:
    """Mixed into a DRF view before its base, so the view's errors carry codes."""

    def get_exception_handler(self) -> Callable[[Exception, dict[str, Any]], Response | None]:
        return full_details_handler
