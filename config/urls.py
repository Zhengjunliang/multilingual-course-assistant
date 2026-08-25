"""Root URL map.

Each app owns its own paths; this file only mounts them. `/` deliberately has
nothing on it — the SPA that will live there is a later stage, and a
placeholder view would be one more thing to delete.
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.qa.urls")),
]
