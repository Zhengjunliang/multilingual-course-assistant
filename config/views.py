"""The one view Django serves that is not an API: the SPA's shell.

Every path the SPA routes to on its own — `/`, `/login`, `/c/7` — has to answer
something when the reader reloads it or pastes the link back in, because at
that moment the browser really does ask the server for it. All of them get the
same file and the SPA sorts out which page that was.

The shell is read as a file rather than rendered as a template, which is two
decisions rather than one:

`TemplateView` returns a `TemplateResponse`, and a `TemplateResponse` resolves
its template after the view has returned — so `TemplateDoesNotExist` surfaces
somewhere the view cannot catch it, and a checkout that has not run `just fe`
would answer with a stack trace instead of the sentence that fixes it.

And frontend/index.html contains no Django template syntax at all. Handing it
to the template engine adds a way for it to fail — the day some Vite plugin
inlines a script holding `{{` — in exchange for nothing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.conf import settings
from django.http import HttpResponse
from django.utils.translation import gettext_lazy as _

if TYPE_CHECKING:
    from django.http import HttpRequest

# Written for whoever is running the server, because they are the only person
# who can act on it: the shell is missing exactly when the frontend has never
# been built. Same shape as the engine's unavailability messages — name the
# command, not the condition.
MISSING_BUILD = _("The interface has not been built yet. Run `just fe`, then reload.")


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
