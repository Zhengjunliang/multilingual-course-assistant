"""Every route says who may call it, or the suite fails.

The guard walks the URL tree the way Django resolves it, so a route added in
any app is checked without anyone listing it here. A DRF view has said who may
call it when the permission classes it ends up with are not the ones APIView
falls back on, or when it decides them per request in `get_permissions()`.
What it ends up with, not what its own class body spells: a base class may
declare for its subclasses, and an undecorated `@api_view` or a view that only
inherits the default has declared nothing. The default,
`DEFAULT_PERMISSION_CLASSES` in config/settings.py, stays as a safety net, but
a route that leans on it is a finding.

A route anyone may call is listed in `OPEN` with the reason; so is a view that
decides its permissions per request, since reading its code is the only way to
see what it opens. Every other route must require a login, `IsAuthenticated`
itself among its permission classes, so that `()`, an `OR` with `AllowAny` or
an object check standing alone cannot pass for one. A subtree that answers
for its own access is in `DELEGATED`.

No `django_db` marker, as in tests/test_spa.py: resolving the URL tree reads
no database, and pytest-django refuses any query a test here would attempt.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from django.http import HttpResponse
from django.urls import URLPattern, URLResolver, get_resolver, path
from rest_framework.decorators import api_view
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping, Sequence

    from django.http import HttpRequest
    from django.http.response import HttpResponseBase
    from rest_framework.request import Request

# Route name -> why anyone may call it.
OPEN: dict[str, str] = {
    "accounts:me": (
        "GET is how the SPA learns nobody is logged in; SessionView.get_permissions "
        "asks a login for PATCH"
    ),
    "accounts:login": "logging in is what a caller without a session does",
    "accounts:register": "anyone may open an account",
    "spa": "the shell is static HTML; every call it makes is an API route checked here",
}

# URL namespace -> what decides who may call the routes under it.
DELEGATED: dict[str, str] = {
    "admin": "SuperuserAdminSite.has_permission admits superusers only (config/admin.py)",
}


def routes(
    patterns: Sequence[URLPattern | URLResolver], namespace: str = ""
) -> Iterator[tuple[str, Callable[..., object]]]:
    """Every route as (its namespaced name, or its pattern when unnamed; its view)."""
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            inner = pattern.namespace
            nested = f"{namespace}:{inner}" if namespace and inner else inner or namespace
            yield from routes(pattern.url_patterns, nested)
        else:
            name = pattern.name or str(pattern.pattern)
            yield (f"{namespace}:{name}" if namespace else name), pattern.callback


def findings(
    patterns: Sequence[URLPattern | URLResolver],
    open_routes: Mapping[str, str] = OPEN,
    delegated: Mapping[str, str] = DELEGATED,
) -> list[str]:
    """Each route that does not say who may call it, with what is wrong."""
    found: list[str] = []
    for name, callback in routes(patterns):
        if name.split(":")[0] in delegated:
            continue
        view = getattr(callback, "cls", None)
        if not (isinstance(view, type) and issubclass(view, APIView)):
            if name not in open_routes:
                found.append(f"{name}: not a DRF view, and not in OPEN")
            continue
        per_request = view.get_permissions is not APIView.get_permissions
        if per_request:
            if name not in open_routes:
                found.append(f"{name}: decides its permissions per request, and is not in OPEN")
        elif view.permission_classes is APIView.permission_classes:
            found.append(f"{name}: declares no permission_classes")
        elif name not in open_routes and not any(
            permission is IsAuthenticated for permission in view.permission_classes
        ):
            found.append(f"{name}: does not require a login, and is not in OPEN")
    return found


def test_every_route_says_who_may_call_it() -> None:
    assert findings(get_resolver().url_patterns) == []


class _OwnsIt(BasePermission):
    pass


class _OnlyAPIView(APIView):
    def get(self, request: Request) -> Response:
        return Response()


class _OnlyListView(ListAPIView):
    pass


@api_view(["GET"])
def _undecorated(request: Request) -> Response:
    return Response()


class _EmptyTuple(_OnlyAPIView):
    permission_classes = ()


class _OrAllowAny(_OnlyAPIView):
    permission_classes = (IsAuthenticated | AllowAny,)


class _ObjectCheckAlone(_OnlyAPIView):
    permission_classes = (_OwnsIt,)


class _AllowAny(_OnlyAPIView):
    permission_classes = (AllowAny,)


def _plain(request: HttpRequest) -> HttpResponse:
    return HttpResponse()


class _PerRequest(_OnlyAPIView):
    def get_permissions(self) -> list[BasePermission]:
        return [AllowAny()]


class _DeclaredByItsBase(_OnlyAPIView):
    permission_classes = (IsAuthenticated, _OwnsIt)


class _InheritsTheDeclaration(_DeclaredByItsBase):
    pass


@pytest.mark.parametrize(
    ("view", "is_open", "reported"),
    [
        pytest.param(_OnlyAPIView.as_view(), False, True, id="only-inherits-APIView"),
        pytest.param(_OnlyListView.as_view(), False, True, id="only-inherits-ListAPIView"),
        pytest.param(_undecorated, False, True, id="undecorated-api_view"),
        pytest.param(_EmptyTuple.as_view(), False, True, id="empty-tuple"),
        pytest.param(_OrAllowAny.as_view(), False, True, id="or-with-AllowAny"),
        pytest.param(_ObjectCheckAlone.as_view(), False, True, id="object-check-alone"),
        pytest.param(_AllowAny.as_view(), False, True, id="AllowAny-not-in-OPEN"),
        pytest.param(_plain, False, True, id="plain-function-view"),
        pytest.param(_PerRequest.as_view(), True, False, id="per-request-in-OPEN"),
        pytest.param(_InheritsTheDeclaration.as_view(), False, False, id="declared-by-its-base"),
    ],
)
def test_a_route_that_says_nothing_is_reported(
    view: Callable[..., HttpResponseBase], is_open: bool, reported: bool
) -> None:
    open_routes = {"route": "a reason"} if is_open else {}

    found = findings([path("route", view, name="route")], open_routes, {})

    assert [finding.split(":")[0] for finding in found] == (["route"] if reported else [])


def test_the_walk_reaches_every_app() -> None:
    """Without this, a walk that stopped descending would find nothing wrong."""
    reached = {name for name, _ in routes(get_resolver().url_patterns)}

    assert reached >= {
        "accounts:me",
        "accounts:logout",
        "qa:ask",
        "qa:conversation",
        "catalog:editions",
        "spa",
    }


def test_every_exemption_names_a_route() -> None:
    reached = {name for name, _ in routes(get_resolver().url_patterns)}

    assert set(OPEN) <= reached
    assert all(any(name.startswith(f"{space}:") for name in reached) for space in DELEGATED)
