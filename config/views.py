"""The views Django serves outside the apps: the SPA's shell, and the API's fallbacks.

Every path the SPA routes to on its own — `/`, `/login`, `/c/7` — has to answer
something when the reader reloads it or pastes the link back in, because at
that moment the browser really does ask the server for it. All of them get the
same file and the SPA sorts out which page that was.

The shell is read as a file rather than rendered as a template, which is two
decisions rather than one:

`TemplateView` returns a `TemplateResponse`, and a `TemplateResponse` resolves
its template after the view has returned — so `TemplateDoesNotExist` surfaces
somewhere the view cannot catch it, and a checkout whose frontend was never
built would answer with a stack trace instead of the sentence that fixes it.

And frontend/index.html contains no Django template syntax at all. Handing it
to the template engine adds a way for it to fail — the day some Vite plugin
inlines a script holding `{{` — in exchange for nothing.

An `/api/` path no view has, a request Django refuses before any view runs,
and a 500 no API view answered itself, are answered in the API's coded error
body (config/errors.py) rather than with a page of HTML, which a caller would
meet as a JSON parse error.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.utils.translation import gettext_lazy as _
from django.views import defaults
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from config.errors import SPEC, ErrorCode, error_body, fail

if TYPE_CHECKING:
    from django.http import HttpRequest
    from rest_framework.request import Request

# Written for whoever is running the server, because they are the only person
# who can act on it: the shell is missing exactly when the frontend has never
# been built. Same shape as the engine's unavailability messages — name the
# command, not the condition.
MISSING_BUILD = _(
    "The interface has not been built yet. Run `npm run build --prefix frontend`, then reload."
)


def spa(request: HttpRequest) -> HttpResponse:
    """Serve the built SPA's entry point, or say how to build it.

    Read on every request rather than cached at import: a rebuild then shows up
    on the next reload, and one small file off the page cache is nothing beside
    the answer this page is about to wait tens of seconds for.
    """
    try:
        shell = (settings.SPA_DIST / "index.html").read_bytes()
    except OSError:
        # `str()` resolves the lazy message here rather than at import, and
        # keeps HttpResponse from treating the proxy as an iterable of
        # characters — it has str's `__iter__` but is not a str.
        return HttpResponse(
            str(MISSING_BUILD), status=503, content_type="text/plain; charset=utf-8"
        )
    return HttpResponse(shell, content_type="text/html; charset=utf-8")


class ApiNotFound(APIView):
    """Every `/api/` path no view has, whatever the method: `NOT_FOUND`.

    It refuses before reading who asks, so an unknown path answers anyone the
    same, and before the method is looked at, which no view here has.
    """

    authentication_classes = ()
    permission_classes = (AllowAny,)

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        fail(ErrorCode.NOT_FOUND)


def bad_request(request: HttpRequest, exception: Exception) -> HttpResponse:
    """A request Django's middleware refused before any view ran (`handler400`):
    a `Host` the site does not serve, or a session another request ended. The
    coded body under `/api/`."""
    if request.path.startswith("/api/"):
        status = SPEC[ErrorCode.MALFORMED_REQUEST].status
        return JsonResponse(error_body(ErrorCode.MALFORMED_REQUEST), status=status)
    return defaults.bad_request(request, exception)


def server_error(request: HttpRequest) -> HttpResponse:
    """A 500 that no API view answered itself (`handler500`): the coded body under `/api/`."""
    if request.path.startswith("/api/"):
        status = SPEC[ErrorCode.INTERNAL].status
        return JsonResponse(error_body(ErrorCode.INTERNAL), status=status)
    return defaults.server_error(request)
