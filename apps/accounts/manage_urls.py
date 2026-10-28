"""URL map for the superusers' account API; config/urls.py mounts it under `/api/admin/`.

`manage` and not `admin` as the namespace: `admin` is Django's admin site,
whose routes answer for their own access (tests/test_route_permissions.py,
`DELEGATED`), and these are DRF's, checked like every other.
"""

from django.urls import path

from apps.accounts.manage_views import (
    ActivateView,
    DeactivateView,
    EndSessionsView,
    ResetLinkView,
    UserListView,
    UserView,
)

app_name = "manage"

urlpatterns = [
    # No trailing slash, as in apps/accounts/urls.py.
    path("users", UserListView.as_view(), name="users"),
    path("users/<int:pk>", UserView.as_view(), name="user"),
    path("users/<int:pk>/deactivate", DeactivateView.as_view(), name="user-deactivate"),
    path("users/<int:pk>/activate", ActivateView.as_view(), name="user-activate"),
    path("users/<int:pk>/sessions/end", EndSessionsView.as_view(), name="user-sessions-end"),
    path("users/<int:pk>/reset-link", ResetLinkView.as_view(), name="user-reset-link"),
]
