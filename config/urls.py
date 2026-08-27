"""Root URL map.

Each app owns its own paths; this file only mounts them. What is left over goes
to the SPA, which is why the last pattern matches almost everything.

That pattern's negative lookahead is the load-bearing part. Django keeps trying
patterns after `include("apps.qa.urls")` declines a path, so a bare `^.*$`
would answer `/api/typo` with a page of HTML and a 200 — leaving a caller to
discover their typo as a JSON parse error on `<!doctype html>`, a symptom that
points nowhere near its cause. Excluding the prefixes Django owns lets a wrong
API path be the 404 it is.
"""

from django.contrib import admin
from django.urls import include, path, re_path

from config.views import spa

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.qa.urls")),
    re_path(r"^(?!api/|admin/|static/).*$", spa, name="spa"),
]
