"""URL map for the account API; config/urls.py mounts it under `/api/auth/`."""

from django.urls import path

from apps.accounts.views import LoginView, LogoutView, RegisterView, SessionView

app_name = "accounts"

urlpatterns = [
    # No trailing slash, matching `/api/ask` (apps/qa/urls.py): APPEND_SLASH
    # only redirects when nothing resolves, and it could not rescue a POST
    # anyway, since the 301 it issues drops the body.
    path("me", SessionView.as_view(), name="me"),
    path("login", LoginView.as_view(), name="login"),
    path("logout", LogoutView.as_view(), name="logout"),
    path("register", RegisterView.as_view(), name="register"),
]
